import { randomUUID } from 'node:crypto';
import { Client, Guild, GuildMember } from 'discord.js';
import { inject, injectable } from 'inversify';
import { Prisma } from '../db/prisma';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { IRoleQuarantineSnapshotRepository } from '../repositories/RoleQuarantineSnapshotRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  RoleQuarantineSnapshot,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import {
  CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_LEASE_MS,
  isCaseAttentionAttempt,
  isCaseTerminalActionAttempt,
  isCaptchaPresentationAttempt,
} from '../utils/caseRoleRelease';
import { CaseRoleLockdownAuditContext, ICaseRoleLockdownService } from './CaseRoleLockdownService';
import { IModerationQueueService } from './ModerationQueueService';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import { IRoleQuarantineService } from './RoleQuarantineService';

const CASE_ROLE_RELEASE_RECONCILIATION_INTERVAL_MS = 60 * 1000;

export interface ICaseRoleReleaseReconciliationService {
  start(): void;
  stop(): void;
  runOnce(now?: Date): Promise<void>;
}

@injectable()
export class CaseRoleReleaseReconciliationService implements ICaseRoleReleaseReconciliationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly roleRestorationAlertedSnapshotIds = new Set<string>();

  constructor(
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.RoleManager) private readonly roleManager: IRoleManager,
    @inject(TYPES.RoleQuarantineSnapshotRepository)
    private readonly snapshotRepository: IRoleQuarantineSnapshotRepository,
    @inject(TYPES.RoleQuarantineService)
    private readonly roleQuarantineService: IRoleQuarantineService,
    @inject(TYPES.CaseRoleLockdownService)
    private readonly lockdownService: ICaseRoleLockdownService,
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.NotificationManager)
    private readonly notificationManager: INotificationManager,
    @inject(TYPES.ModerationQueueService)
    private readonly moderationQueueService: IModerationQueueService
  ) {}

  public start(): void {
    if (this.timer) {
      return;
    }

    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, CASE_ROLE_RELEASE_RECONCILIATION_INTERVAL_MS);
  }

  public stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);
    this.timer = null;
  }

  public async runOnce(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const staleBefore = new Date(now.getTime() - CASE_ROLE_RELEASE_LEASE_MS);
      const expiredClaims =
        await this.verificationEventRepository.findExpiredCaseRoleReleases(staleBefore);
      for (const verificationEvent of expiredClaims) {
        await this.reconcileCaseRole(verificationEvent.id, staleBefore).catch((error) => {
          console.error(
            `Failed to reconcile expired case-role release for case ${verificationEvent.id}:`,
            error
          );
        });
      }
      const expiredQuarantineAttempts =
        await this.verificationEventRepository.findExpiredQuarantineAttempts(staleBefore);
      for (const verificationEvent of expiredQuarantineAttempts) {
        await this.reconcileExpiredQuarantineAttempt(verificationEvent, staleBefore, now).catch(
          (error) => {
            console.error(
              `Failed to reconcile expired quarantine attempt for case ${verificationEvent.id}:`,
              error
            );
          }
        );
      }
      await this.reconcileCompletedRoleRestorations();
      await this.reconcileParkedContainment(now);
    } finally {
      this.running = false;
    }
  }

  private async reconcileExpiredQuarantineAttempt(
    verificationEvent: VerificationEvent,
    staleBefore: Date,
    now: Date
  ): Promise<void> {
    const attemptId = verificationEvent.quarantine_attempt_id;
    if (!attemptId) {
      return;
    }
    if (isCaptchaPresentationAttempt(attemptId)) {
      const recovered = await this.verificationEventRepository.recoverExpiredQuarantineAttempt(
        verificationEvent.id,
        attemptId,
        staleBefore,
        {
          attention_state: verificationEvent.attention_state,
          containment_status: CaseContainmentStatus.NOT_APPLICABLE,
          parked_at: verificationEvent.parked_at,
          parked_by: verificationEvent.parked_by,
          metadata: verificationEvent.metadata,
        }
      );
      if (recovered) {
        await this.moderationQueueService.upsertCaseMirror(recovered);
      }
      return;
    }
    if (isCaseAttentionAttempt(attemptId)) {
      const metadata = {
        ...this.metadataToRecord(verificationEvent.metadata),
        account_quarantine_reconciliation: {
          checked_at: now.toISOString(),
          result: 'incomplete',
          detail: 'Expired attention delivery was returned to moderator review.',
        },
      } as unknown as VerificationEvent['metadata'];
      const recovered = await this.verificationEventRepository.recoverExpiredQuarantineAttempt(
        verificationEvent.id,
        attemptId,
        staleBefore,
        {
          attention_state: CaseAttentionState.REVIEW_REQUIRED,
          containment_status: CaseContainmentStatus.INCOMPLETE,
          parked_at: null,
          parked_by: null,
          metadata,
        }
      );
      if (recovered) {
        await Promise.allSettled([
          this.notificationManager.notifyAccountQuarantineAttention(
            recovered,
            'attention_delivery_incomplete'
          ),
          this.moderationQueueService.upsertCaseMirror(recovered),
        ]);
      }
      return;
    }

    const metadata = {
      ...this.metadataToRecord(verificationEvent.metadata),
      account_quarantine_reconciliation: {
        checked_at: now.toISOString(),
        result: 'incomplete',
        detail: isCaseTerminalActionAttempt(attemptId)
          ? 'Expired terminal-action claim was returned to moderator review.'
          : 'Expired quarantine-entry attempt was returned to moderator review.',
      },
    } as unknown as VerificationEvent['metadata'];
    const recovered = await this.verificationEventRepository.recoverExpiredQuarantineAttempt(
      verificationEvent.id,
      attemptId,
      staleBefore,
      {
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
        metadata,
      }
    );
    if (recovered) {
      await this.surfaceReviewRequired(recovered);
    }
  }

  private async reconcileCaseRole(verificationEventId: string, staleBefore: Date): Promise<void> {
    const candidate = await this.verificationEventRepository.findById(verificationEventId);
    if (!candidate) {
      return;
    }

    const attemptId = `${CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX}${randomUUID()}`;
    const claimed = await this.verificationEventRepository.claimCaseRoleRelease(
      candidate.id,
      candidate.server_id,
      candidate.user_id,
      attemptId,
      staleBefore
    );
    if (!claimed) {
      return;
    }

    try {
      const guild =
        this.client.guilds.cache.get(claimed.server_id) ??
        (await this.client.guilds.fetch(claimed.server_id));
      const member = await guild.members.fetch(claimed.user_id);
      const restored = claimed.quarantine_case_role_id
        ? await this.roleManager.assignCaseRole(member, claimed.quarantine_case_role_id)
        : await this.roleManager.assignCaseRole(member);
      if (!restored) {
        throw new Error('Configured case role could not be restored.');
      }

      const completed = await this.verificationEventRepository.updateQuarantineAttempt(
        claimed.id,
        attemptId,
        {
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          attention_state: claimed.attention_state,
          containment_status:
            claimed.attention_state === CaseAttentionState.PARKED
              ? CaseContainmentStatus.CONTAINED
              : CaseContainmentStatus.INCOMPLETE,
          parked_at:
            claimed.attention_state === CaseAttentionState.PARKED ? claimed.parked_at : null,
          parked_by:
            claimed.attention_state === CaseAttentionState.PARKED ? claimed.parked_by : null,
        }
      );
      if (!completed) {
        throw new Error('Release-recovery ownership changed before completion.');
      }
    } catch (error) {
      const fallback = await this.verificationEventRepository.updateQuarantineAttempt(
        claimed.id,
        attemptId,
        {
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          attention_state: CaseAttentionState.REVIEW_REQUIRED,
          containment_status: CaseContainmentStatus.INCOMPLETE,
          parked_at: null,
          parked_by: null,
        }
      );
      if (fallback) {
        await this.surfaceReviewRequired(fallback);
      }
      throw error;
    }
  }

  private async reconcileCompletedRoleRestorations(): Promise<void> {
    const snapshots = await this.snapshotRepository.findActiveCompletedForRestoration();
    for (const snapshot of snapshots) {
      await this.reconcileCompletedRoleRestoration(snapshot).catch((error) => {
        console.error(`Failed to reconcile role restoration for snapshot ${snapshot.id}:`, error);
      });
    }
  }

  private async reconcileCompletedRoleRestoration(snapshot: RoleQuarantineSnapshot): Promise<void> {
    if (!snapshot.verification_event_id) {
      return;
    }
    const verificationEvent = await this.verificationEventRepository.findById(
      snapshot.verification_event_id
    );
    if (!verificationEvent) {
      return;
    }
    if (verificationEvent.status !== VerificationStatus.VERIFIED) {
      return;
    }
    const hasPendingCase = (
      await this.verificationEventRepository.findByUserAndServer(
        snapshot.user_id,
        snapshot.server_id
      )
    ).some((event) => event.status === VerificationStatus.PENDING);
    if (hasPendingCase) {
      return;
    }

    try {
      const member = await this.fetchMember(snapshot.server_id, snapshot.user_id);
      if (
        snapshot.created_at &&
        member.joinedAt &&
        member.joinedAt.getTime() > snapshot.created_at.getTime()
      ) {
        await this.roleQuarantineService.abandonActiveSnapshot(
          snapshot.server_id,
          snapshot.user_id,
          'membership_replaced_before_role_restoration'
        );
        this.roleRestorationAlertedSnapshotIds.delete(snapshot.id);
        return;
      }
      const result = await this.roleQuarantineService.restoreMemberRoles(member, undefined, {
        canRestoreRole: async () =>
          !(await this.verificationEventRepository.findActiveByUserAndServer(
            snapshot.user_id,
            snapshot.server_id
          )),
      });
      if (
        result.status === 'restored' ||
        result.status === 'no_active_snapshot' ||
        result.status === 'abandoned_membership_changed' ||
        result.status === 'held_pending_case'
      ) {
        this.roleRestorationAlertedSnapshotIds.delete(snapshot.id);
        return;
      }
    } catch (error) {
      if (!this.roleRestorationAlertedSnapshotIds.has(snapshot.id)) {
        const notified = await this.notificationManager.notifyAccountQuarantineAttention(
          verificationEvent,
          'role_restoration_incomplete'
        );
        if (notified) {
          this.roleRestorationAlertedSnapshotIds.add(snapshot.id);
        }
      }
      throw error;
    }

    if (!this.roleRestorationAlertedSnapshotIds.has(snapshot.id)) {
      const notified = await this.notificationManager.notifyAccountQuarantineAttention(
        verificationEvent,
        'role_restoration_incomplete'
      );
      if (notified) {
        this.roleRestorationAlertedSnapshotIds.add(snapshot.id);
      }
    }
  }

  private async reconcileParkedContainment(now: Date): Promise<void> {
    const auditContext: CaseRoleLockdownAuditContext = {
      siblingThreadsByParentId: new Map(),
    };
    for (const guild of this.client.guilds.cache.values()) {
      const parkedCases = await this.verificationEventRepository.findParkedByServer(guild.id);
      for (const verificationEvent of parkedCases) {
        if (
          verificationEvent.case_kind !== CaseKind.COMPROMISED_ACCOUNT ||
          verificationEvent.containment_status !== CaseContainmentStatus.CONTAINED ||
          verificationEvent.quarantine_attempt_id !== null
        ) {
          continue;
        }
        await this.reconcileParkedCase(guild, verificationEvent, now, auditContext).catch(
          (error) => {
            console.error(
              `Failed to reconcile parked containment for case ${verificationEvent.id}:`,
              error
            );
          }
        );
      }
    }
  }

  private async reconcileParkedCase(
    guild: Guild,
    verificationEvent: VerificationEvent,
    now: Date,
    auditContext: CaseRoleLockdownAuditContext
  ): Promise<void> {
    let member: GuildMember | null = null;
    let caseRolePresent = false;
    let containmentReady = false;
    let recoveryThreadReady = false;
    let detail = 'Live containment audit failed.';
    try {
      recoveryThreadReady = await this.ensureParkedRecoveryThreadOpen(verificationEvent.thread_id);
      member = await guild.members.fetch(verificationEvent.user_id);
      const serverConfig = await this.configService.getServerConfig(guild.id);
      const assignedCaseRoleId =
        verificationEvent.quarantine_case_role_id ?? serverConfig.case_role_id;
      caseRolePresent = assignedCaseRoleId !== null && member.roles.cache.has(assignedCaseRoleId);
      const [lockdown, memberAudit] = await Promise.all([
        this.lockdownService.auditGuild(guild, verificationEvent.thread_id, assignedCaseRoleId),
        this.lockdownService.auditMemberBypasses(
          member,
          new Set(),
          verificationEvent.thread_id,
          assignedCaseRoleId,
          auditContext
        ),
      ]);
      const blockingWarning = lockdown.issues.some(
        (issue) => issue.code === 'lockdown-case-role-global-permissions'
      );
      containmentReady =
        recoveryThreadReady &&
        caseRolePresent &&
        lockdown.enabled &&
        lockdown.errorCount === 0 &&
        lockdown.plannedActions.length === 0 &&
        !blockingWarning &&
        memberAudit.bypasses.length === 0 &&
        memberAudit.retainedPrivilegedRoleIds.length === 0 &&
        memberAudit.retainedAdministratorRoleIds.length === 0 &&
        memberAudit.unremovablePrivilegeReasons.length === 0;
      detail = containmentReady
        ? 'Live containment audit passed.'
        : `Live containment audit found drift: recovery thread ready=${recoveryThreadReady}, case role present=${caseRolePresent}, lockdown errors=${lockdown.errorCount}, planned actions=${lockdown.plannedActions.length}, bypasses=${memberAudit.bypasses.length}, privileged roles=${memberAudit.retainedPrivilegedRoleIds.length}, unremovable privileges=${memberAudit.unremovablePrivilegeReasons.length}.`;
    } catch (error) {
      detail = `Live containment audit failed: ${this.formatError(error)}`;
    }
    if (containmentReady) {
      return;
    }

    const metadata = {
      ...this.metadataToRecord(verificationEvent.metadata),
      account_quarantine_reconciliation: {
        checked_at: now.toISOString(),
        result: 'incomplete',
        detail,
      },
    } as unknown as VerificationEvent['metadata'];
    const updated = await this.verificationEventRepository.markParkedContainmentIncomplete(
      verificationEvent.id,
      metadata
    );
    if (updated) {
      await this.surfaceReviewRequired(updated);
    }
  }

  private async surfaceReviewRequired(verificationEvent: VerificationEvent): Promise<void> {
    await Promise.allSettled([
      this.notificationManager.notifyAccountQuarantineAttention(
        verificationEvent,
        'containment_incomplete'
      ),
      this.moderationQueueService.upsertCaseMirror(verificationEvent),
    ]);
  }

  private async ensureParkedRecoveryThreadOpen(threadId: string | null): Promise<boolean> {
    if (!threadId) {
      return false;
    }
    const channel = await this.client.channels.fetch(threadId).catch(() => null);
    if (!channel?.isThread()) {
      return false;
    }
    if (channel.archived) {
      await channel.setArchived(false, 'Keep parked account-recovery thread available');
    }
    if (channel.locked) {
      await channel.setLocked(false, 'Keep parked account-recovery thread available');
    }
    return true;
  }

  private async fetchMember(serverId: string, userId: string): Promise<GuildMember> {
    const guild =
      this.client.guilds.cache.get(serverId) ?? (await this.client.guilds.fetch(serverId));
    return guild.members.fetch(userId);
  }

  private metadataToRecord(metadata: Prisma.JsonValue | null): Record<string, unknown> {
    return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
  }
}
