import { GuildMember, User } from 'discord.js';
import { randomUUID } from 'node:crypto';
import { inject, injectable } from 'inversify';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IConfigService } from '../config/ConfigService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  AdminActionType,
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  ModerationOutcomeSource,
  ModerationOutcomeType,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import { getAccountQuarantineSettings } from '../utils/accountQuarantineSettings';
import { IAdminActionService } from './AdminActionService';
import {
  CaseRoleLockdownMemberAudit,
  CaseRoleLockdownReport,
  ICaseRoleLockdownService,
} from './CaseRoleLockdownService';
import { IModerationOutcomeService } from './ModerationOutcomeService';
import { IModerationQueueService } from './ModerationQueueService';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import {
  IRoleQuarantineService,
  RoleQuarantineApplyError,
  RoleQuarantineApplyResult,
  RoleQuarantinePreviewResult,
} from './RoleQuarantineService';

const QUARANTINE_ATTEMPT_STALE_MS = 5 * 60 * 1000;

export interface AccountQuarantinePreview {
  readonly enabled: boolean;
  readonly rolePreview: RoleQuarantinePreviewResult;
  readonly lockdown: CaseRoleLockdownReport;
  readonly memberAudit: CaseRoleLockdownMemberAudit;
  readonly canContain: boolean;
}

export interface AccountQuarantineResult {
  readonly status: 'parked' | 'incomplete';
  readonly verificationEvent: VerificationEvent;
  readonly roleResult: RoleQuarantineApplyResult;
  readonly lockdown: CaseRoleLockdownReport;
  readonly memberAudit: CaseRoleLockdownMemberAudit;
}

export interface IAccountQuarantineService {
  preview(member: GuildMember, event: VerificationEvent): Promise<AccountQuarantinePreview>;
  quarantine(
    member: GuildMember,
    event: VerificationEvent,
    moderator: User,
    reason: string
  ): Promise<AccountQuarantineResult>;
}

@injectable()
export class AccountQuarantineService implements IAccountQuarantineService {
  public constructor(
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEvents: IVerificationEventRepository,
    @inject(TYPES.RoleQuarantineService)
    private readonly roleQuarantine: IRoleQuarantineService,
    @inject(TYPES.CaseRoleLockdownService)
    private readonly lockdown: ICaseRoleLockdownService,
    @inject(TYPES.RoleManager) private readonly roleManager: IRoleManager,
    @inject(TYPES.AdminActionService) private readonly adminActions: IAdminActionService,
    @inject(TYPES.ModerationOutcomeService)
    private readonly moderationOutcomes: IModerationOutcomeService,
    @inject(TYPES.ModerationQueueService)
    private readonly moderationQueue: IModerationQueueService,
    @inject(TYPES.NotificationManager)
    private readonly notificationManager: INotificationManager
  ) {}

  public async preview(
    member: GuildMember,
    event: VerificationEvent
  ): Promise<AccountQuarantinePreview> {
    this.assertActiveTarget(member, event);
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const rolePreview = await this.roleQuarantine.previewCompromisedAccount(member);
    const [lockdown, memberAudit] = await Promise.all([
      this.lockdown.auditGuild(member.guild, event.thread_id, serverConfig.case_role_id),
      this.lockdown.auditMemberBypasses(
        member,
        new Set(rolePreview.plannedRoleIds),
        event.thread_id,
        serverConfig.case_role_id
      ),
    ]);
    return {
      enabled: getAccountQuarantineSettings(serverConfig.settings).enabled,
      rolePreview,
      lockdown,
      memberAudit,
      canContain: this.isContainmentReady(lockdown, memberAudit),
    };
  }

  public async quarantine(
    member: GuildMember,
    event: VerificationEvent,
    moderator: User,
    reason: string
  ): Promise<AccountQuarantineResult> {
    this.assertActiveTarget(member, event);
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw new Error('A quarantine reason is required.');
    }
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    if (!getAccountQuarantineSettings(serverConfig.settings).enabled) {
      throw new Error('Compromised-account quarantine is disabled for this server.');
    }

    const attemptId = randomUUID();
    const claimedEvent = await this.verificationEvents.claimQuarantineAttempt(
      event.id,
      member.guild.id,
      member.id,
      attemptId,
      new Date(Date.now() - QUARANTINE_ATTEMPT_STALE_MS)
    );
    if (!claimedEvent) {
      throw new Error('This case is already parked or another quarantine attempt is in progress.');
    }

    let roleResult: RoleQuarantineApplyResult | undefined;
    let caseRoleAssigned: boolean;
    let lockdown: CaseRoleLockdownReport;
    let memberAudit: CaseRoleLockdownMemberAudit;
    let failureStage = 'role_removal';
    const assignedCaseRoleId = serverConfig.case_role_id;
    try {
      roleResult = await this.roleQuarantine.quarantineCompromisedAccount(
        member,
        claimedEvent,
        moderator,
        {
          attemptId,
          assertOwner: () => this.assertAttemptOwner(claimedEvent.id, attemptId),
        }
      );
      await this.assertAttemptOwner(claimedEvent.id, attemptId);
      failureStage = 'case_role_assignment';
      if (
        assignedCaseRoleId &&
        !(await this.verificationEvents.recordQuarantineCaseRole(
          claimedEvent.id,
          attemptId,
          assignedCaseRoleId
        ))
      ) {
        throw new Error('The intended quarantine case role could not be durably recorded.');
      }
      caseRoleAssigned = assignedCaseRoleId
        ? await this.roleManager.assignCaseRole(member, assignedCaseRoleId)
        : false;
      await this.assertAttemptOwner(claimedEvent.id, attemptId);
      failureStage = 'containment_audit';
      [lockdown, memberAudit] = await Promise.all([
        this.lockdown.auditGuild(member.guild, claimedEvent.thread_id, assignedCaseRoleId),
        this.lockdown.auditMemberBypasses(
          member,
          new Set(),
          claimedEvent.thread_id,
          assignedCaseRoleId
        ),
      ]);
      await this.assertAttemptOwner(claimedEvent.id, attemptId);
      failureStage = 'final_role_sweep';
      roleResult = await this.roleQuarantine.quarantineCompromisedAccount(
        member,
        claimedEvent,
        moderator,
        {
          attemptId,
          assertOwner: () => this.assertAttemptOwner(claimedEvent.id, attemptId),
        }
      );
      await this.assertAttemptOwner(claimedEvent.id, attemptId);
      failureStage = 'final_containment_audit';
      [lockdown, memberAudit] = await Promise.all([
        this.lockdown.auditGuild(member.guild, claimedEvent.thread_id, assignedCaseRoleId),
        this.lockdown.auditMemberBypasses(
          member,
          new Set(),
          claimedEvent.thread_id,
          assignedCaseRoleId
        ),
      ]);
      await this.assertAttemptOwner(claimedEvent.id, attemptId);
    } catch (error) {
      if (error instanceof RoleQuarantineApplyError) {
        roleResult = error.result;
      }
      await this.recordFailedAttempt({
        claimedEvent,
        attemptId,
        error,
        failureStage,
        member,
        moderator,
        reason: trimmedReason,
        roleResult,
      });
      throw error;
    }
    const complete =
      caseRoleAssigned &&
      roleResult.failedRemovals.length === 0 &&
      this.isContainmentReady(lockdown, memberAudit);
    const now = new Date();
    const auditMetadata = {
      attempted_at: now.toISOString(),
      attempted_by: moderator.id,
      reason: trimmedReason,
      result: complete ? 'contained' : 'incomplete',
      case_role_assigned: caseRoleAssigned,
      case_role_id: caseRoleAssigned ? assignedCaseRoleId : null,
      snapshot_id: roleResult.snapshotId,
      removed_role_ids: roleResult.removedRoleIds,
      retained_roles: roleResult.skippedRoles,
      failed_removals: roleResult.failedRemovals,
      lockdown_error_count: lockdown.errorCount,
      lockdown_warning_count: lockdown.warningCount,
      member_bypasses: memberAudit.bypasses,
      retained_privileged_role_ids: memberAudit.retainedPrivilegedRoleIds,
      retained_administrator_role_ids: memberAudit.retainedAdministratorRoleIds,
      unremovable_privilege_reasons: memberAudit.unremovablePrivilegeReasons,
    };
    const metadata = {
      ...this.metadataToRecord(claimedEvent.metadata),
      account_quarantine: auditMetadata,
    } as unknown as VerificationEvent['metadata'];
    let updated: VerificationEvent | null;
    try {
      updated = await this.verificationEvents.updateQuarantineAttempt(claimedEvent.id, attemptId, {
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: complete ? CaseAttentionState.PARKED : CaseAttentionState.REVIEW_REQUIRED,
        containment_status: complete
          ? CaseContainmentStatus.CONTAINED
          : CaseContainmentStatus.INCOMPLETE,
        parked_at: complete ? now : null,
        parked_by: complete ? moderator.id : null,
        quarantine_case_role_id: caseRoleAssigned ? assignedCaseRoleId : undefined,
        metadata,
      });
    } catch (error) {
      await this.recordFailedAttempt({
        claimedEvent,
        attemptId,
        error,
        failureStage: 'case_state_persistence',
        member,
        moderator,
        reason: trimmedReason,
        roleResult,
      });
      throw error;
    }
    if (!updated) {
      const stateError = new Error(
        `Quarantine attempt for verification event ${claimedEvent.id} was superseded or the case was resolved.`
      );
      await this.recordFailedAttempt({
        claimedEvent,
        attemptId,
        error: stateError,
        failureStage: 'case_state_persistence',
        member,
        moderator,
        reason: trimmedReason,
        roleResult,
      });
      throw stateError;
    }

    await this.adminActions
      .recordAction({
        server_id: member.guild.id,
        user_id: member.id,
        admin_id: moderator.id,
        verification_event_id: claimedEvent.id,
        detection_event_id: claimedEvent.detection_event_id,
        action_type: AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.PENDING,
        notes: trimmedReason,
        metadata: auditMetadata as unknown as Prisma.JsonValue,
      })
      .catch((error) => {
        console.error(`Failed to audit quarantine attempt ${claimedEvent.id}:`, error);
      });

    if (complete) {
      await this.moderationOutcomes
        .recordOutcome({
          server_id: member.guild.id,
          user_id: member.id,
          detection_event_id: claimedEvent.detection_event_id,
          verification_event_id: claimedEvent.id,
          outcome_type: ModerationOutcomeType.ACCOUNT_QUARANTINED,
          source: ModerationOutcomeSource.DRASIL,
          actor_id: moderator.id,
          reason: trimmedReason,
          occurred_at: now,
          metadata: auditMetadata as unknown as Prisma.JsonValue,
          username: member.user.username,
          accountCreatedAt: member.user.createdAt,
        })
        .catch((error) => {
          console.error(`Failed to record quarantine outcome ${claimedEvent.id}:`, error);
        });
    }

    await this.refreshPersistentNotification(updated, moderator);
    if (complete) {
      await this.moderationQueue.deleteCaseMirror(claimedEvent.id);
    } else {
      await this.moderationQueue.upsertCaseMirror(updated);
    }

    return {
      status: complete ? 'parked' : 'incomplete',
      verificationEvent: updated,
      roleResult,
      lockdown,
      memberAudit,
    };
  }

  private assertActiveTarget(member: GuildMember, event: VerificationEvent): void {
    if (
      event.server_id !== member.guild.id ||
      event.user_id !== member.id ||
      event.status !== VerificationStatus.PENDING
    ) {
      throw new Error('Compromised-account quarantine requires the matching active case.');
    }
  }

  private isContainmentReady(
    report: CaseRoleLockdownReport,
    memberAudit: CaseRoleLockdownMemberAudit
  ): boolean {
    const blockingWarning = report.issues.some(
      (issue) => issue.code === 'lockdown-case-role-global-permissions'
    );
    return (
      report.enabled &&
      report.errorCount === 0 &&
      report.plannedActions.length === 0 &&
      !blockingWarning &&
      memberAudit.bypasses.length === 0 &&
      memberAudit.retainedPrivilegedRoleIds.length === 0 &&
      memberAudit.retainedAdministratorRoleIds.length === 0 &&
      memberAudit.unremovablePrivilegeReasons.length === 0
    );
  }

  private async recordFailedAttempt(input: {
    readonly claimedEvent: VerificationEvent;
    readonly attemptId: string;
    readonly error: unknown;
    readonly failureStage: string;
    readonly member: GuildMember;
    readonly moderator: User;
    readonly reason: string;
    readonly roleResult?: RoleQuarantineApplyResult;
  }): Promise<void> {
    const failureMetadata = {
      attempted_at: new Date().toISOString(),
      attempted_by: input.moderator.id,
      reason: input.reason,
      result: 'failed',
      failure_stage: input.failureStage,
      error: this.formatError(input.error),
      snapshot_id: input.roleResult?.snapshotId ?? null,
      removed_role_ids: input.roleResult?.removedRoleIds ?? [],
      retained_roles: input.roleResult?.skippedRoles ?? [],
      failed_removals: input.roleResult?.failedRemovals ?? [],
    };
    const metadata = {
      ...this.metadataToRecord(input.claimedEvent.metadata),
      account_quarantine: failureMetadata,
    } as unknown as VerificationEvent['metadata'];
    const updated = await this.verificationEvents
      .updateQuarantineAttempt(input.claimedEvent.id, input.attemptId, {
        case_kind: CaseKind.COMPROMISED_ACCOUNT,
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
        metadata,
      })
      .catch((error) => {
        console.error(
          `Failed to persist failed quarantine attempt ${input.claimedEvent.id}:`,
          error
        );
        return null;
      });
    await this.adminActions
      .recordAction({
        server_id: input.member.guild.id,
        user_id: input.member.id,
        admin_id: input.moderator.id,
        verification_event_id: input.claimedEvent.id,
        detection_event_id: input.claimedEvent.detection_event_id,
        action_type: AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.PENDING,
        notes: input.reason,
        metadata: failureMetadata as unknown as Prisma.JsonValue,
      })
      .catch((error) => {
        console.error(`Failed to audit quarantine attempt ${input.claimedEvent.id}:`, error);
      });
    if (!updated) {
      return;
    }
    await this.refreshPersistentNotification(updated, input.moderator, false);
    await this.moderationQueue.upsertCaseMirror(updated).catch((error) => {
      console.error(`Failed to refresh quarantine case ${input.claimedEvent.id}:`, error);
    });
  }

  private async assertAttemptOwner(eventId: string, attemptId: string): Promise<void> {
    if (!(await this.verificationEvents.renewQuarantineAttempt(eventId, attemptId))) {
      throw new Error('This quarantine attempt was superseded or the case was resolved.');
    }
  }

  private async refreshPersistentNotification(
    event: VerificationEvent,
    moderator: User,
    logAction = true
  ): Promise<void> {
    if (!event.notification_message_id) {
      return;
    }
    if (logAction) {
      await this.notificationManager
        .logActionToMessage(event, AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT, moderator)
        .catch((error) => {
          console.warn(`Failed to append quarantine action to notification ${event.id}:`, error);
        });
    }
    await this.notificationManager
      .updateNotificationButtons(event, VerificationStatus.PENDING)
      .catch((error) => {
        console.warn(`Failed to refresh quarantine notification ${event.id}:`, error);
      });
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    return { ...(metadata as Record<string, unknown>) };
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
