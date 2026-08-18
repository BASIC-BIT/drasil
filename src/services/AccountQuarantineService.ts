import { GuildMember, User } from 'discord.js';
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
import { IRoleManager } from './RoleManager';
import {
  IRoleQuarantineService,
  RoleQuarantineApplyResult,
  RoleQuarantinePreviewResult,
} from './RoleQuarantineService';

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
    private readonly moderationQueue: IModerationQueueService
  ) {}

  public async preview(
    member: GuildMember,
    event: VerificationEvent
  ): Promise<AccountQuarantinePreview> {
    this.assertActiveTarget(member, event);
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const rolePreview = await this.roleQuarantine.previewCompromisedAccount(member);
    const [lockdown, memberAudit] = await Promise.all([
      this.lockdown.auditGuild(member.guild),
      this.lockdown.auditMemberBypasses(member, new Set(rolePreview.plannedRoleIds)),
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

    const roleResult = await this.roleQuarantine.quarantineCompromisedAccount(
      member,
      event,
      moderator
    );
    const caseRoleAssigned = await this.roleManager.assignCaseRole(member);
    const [lockdown, memberAudit] = await Promise.all([
      this.lockdown.auditGuild(member.guild),
      this.lockdown.auditMemberBypasses(member),
    ]);
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
      snapshot_id: roleResult.snapshotId,
      removed_role_ids: roleResult.removedRoleIds,
      retained_roles: roleResult.skippedRoles,
      failed_removals: roleResult.failedRemovals,
      lockdown_error_count: lockdown.errorCount,
      lockdown_warning_count: lockdown.warningCount,
      member_bypasses: memberAudit.bypasses,
      retained_privileged_role_ids: memberAudit.retainedPrivilegedRoleIds,
      retained_administrator_role_ids: memberAudit.retainedAdministratorRoleIds,
    };
    const metadata = {
      ...this.metadataToRecord(event.metadata),
      account_quarantine: auditMetadata,
    } as unknown as VerificationEvent['metadata'];
    const updated = await this.verificationEvents.update(event.id, {
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: complete ? CaseAttentionState.PARKED : CaseAttentionState.REVIEW_REQUIRED,
      containment_status: complete
        ? CaseContainmentStatus.CONTAINED
        : CaseContainmentStatus.INCOMPLETE,
      parked_at: complete ? now : null,
      parked_by: complete ? moderator.id : null,
      metadata,
    });
    if (!updated) {
      throw new Error(`Verification event ${event.id} no longer exists.`);
    }

    await this.adminActions.recordAction({
      server_id: member.guild.id,
      user_id: member.id,
      admin_id: moderator.id,
      verification_event_id: event.id,
      detection_event_id: event.detection_event_id,
      action_type: AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT,
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.PENDING,
      notes: trimmedReason,
      metadata: auditMetadata as unknown as Prisma.JsonValue,
    });

    if (complete) {
      await this.moderationOutcomes.recordOutcome({
        server_id: member.guild.id,
        user_id: member.id,
        detection_event_id: event.detection_event_id,
        verification_event_id: event.id,
        outcome_type: ModerationOutcomeType.ACCOUNT_QUARANTINED,
        source: ModerationOutcomeSource.DRASIL,
        actor_id: moderator.id,
        reason: trimmedReason,
        occurred_at: now,
        metadata: auditMetadata as unknown as Prisma.JsonValue,
        username: member.user.username,
        accountCreatedAt: member.user.createdAt,
      });
      await this.moderationQueue.deleteCaseMirror(event.id);
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
      memberAudit.retainedAdministratorRoleIds.length === 0
    );
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }
    return { ...(metadata as Record<string, unknown>) };
  }
}
