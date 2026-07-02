import { Guild, GuildMember, PartialGuildMember, User } from 'discord.js';
import { injectable, inject, optional } from 'inversify';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { INotificationManager } from './NotificationManager';
import { IRoleManager } from './RoleManager';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  AdminActionType,
  ModerationOutcome,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import { IAdminActionService } from './AdminActionService';
import { IThreadManager } from './ThreadManager';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
} from './ProductAnalyticsService';
import {
  IModerationOutcomeService,
  ModerationOutcomeRecordInput,
  ModerationOutcomeSource,
  ModerationOutcomeType,
} from './ModerationOutcomeService';
import { IModerationQueueService } from './ModerationQueueService';
import {
  IRoleQuarantineService,
  RoleQuarantineApplyResult,
  RoleQuarantineRestoreResult,
} from './RoleQuarantineService';
import { appendVerificationActionFailure } from '../utils/verificationActionFailures';
import {
  getResolutionAdminActionType,
  getResolutionModerationOutcomeType,
  ResolvedVerificationStatus,
} from '../utils/verificationResolution';

/**
 * Interface for the UserModerationService
 */
export interface IUserModerationService {
  /**
   * Applies the configured case role required for active user-facing cases.
   */
  applyCaseRole(member: GuildMember, moderator?: User): Promise<boolean>;

  /**
   * Legacy compatibility path that applies the case role and records historical restrict action types.
   * New case-opening flows should call applyCaseRole.
   */
  restrictUser(member: GuildMember, moderator?: User): Promise<boolean>;

  /**
   * Removes the case role while keeping the active case pending.
   */
  liftRestriction(member: GuildMember, moderator: User): Promise<boolean>;

  /**
   * Removes the case role from a guild member and updates their verification status.
   * @param member The guild member to verify
   * @param moderator The user who performed the verification
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  verifyUser(member: GuildMember, moderator: User): Promise<boolean>;

  /**
   * Bans a user from the guild
   * @param member The guild member to ban
   * @param reason The reason for the ban
   * @param moderator The user who performed the ban
   * @returns Promise resolving to true if successful, false if the user couldn't be banned
   */
  banUser(
    member: GuildMember,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean>;

  banUserById(
    guild: Guild,
    userId: string,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean>;

  kickUser(
    member: GuildMember,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean>;

  /**
   * Synchronizes pending verification cases when Discord already has an existing ban.
   */
  syncAlreadyBannedUser(guild: Guild, userId: string, moderator: User): Promise<number>;

  /**
   * Closes pending verification cases without treating the user as verified or banned.
   */
  closeCaseNoAction(
    guild: Guild,
    userId: string,
    moderator: User,
    notes?: string | null
  ): Promise<number>;

  /**
   * Resolves pending verification cases after observing a Discord ban outside the Drasil action flow.
   */
  recordObservedDiscordBan(
    guild: Guild,
    user: User,
    options: ObservedDiscordBanOptions
  ): Promise<number>;

  recordObservedDiscordKick(
    member: GuildMember | PartialGuildMember,
    options: ObservedDiscordKickOptions
  ): Promise<number>;

  findLatestKickOutcome(serverId: string, userId: string): Promise<ModerationOutcome | null>;

  /**
   * Marks pending verification cases when the user leaves or is removed without closing the case.
   */
  recordMemberLeftGuild(member: GuildMember | PartialGuildMember): Promise<number>;
}

export interface ObservedDiscordBanOptions {
  source: ModerationOutcomeSource;
  actorId?: string | null;
  reason?: string | null;
  sourceDetail?: string | null;
  auditLogEntryId?: string | null;
  occurredAt?: Date;
}

export type ObservedDiscordKickOptions = ObservedDiscordBanOptions;

interface ModerationTarget {
  guildId: string;
  userId: string;
  userTag: string;
  username?: string | null;
  accountCreatedAt?: Date | null;
}

/**
 * Service for managing user moderation actions like restricting, verifying, and banning users
 */
@injectable()
export class UserModerationService implements IUserModerationService {
  private serverMemberRepository: IServerMemberRepository;
  private notificationManager: INotificationManager; // Keep for now, might be replaced by events later
  private roleManager: IRoleManager; // Keep for now, might be replaced by events later
  private verificationEventRepository: IVerificationEventRepository;
  private adminActionService: IAdminActionService; // Keep for now, might be replaced by events later
  private threadManager: IThreadManager;
  private productAnalyticsService: IProductAnalyticsService;
  private moderationOutcomeService?: IModerationOutcomeService;
  private moderationQueueService?: IModerationQueueService;
  private roleQuarantineService?: IRoleQuarantineService;

  constructor(
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.AdminActionService) adminActionService: IAdminActionService,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.ProductAnalyticsService)
    @optional()
    productAnalyticsService?: IProductAnalyticsService,
    @inject(TYPES.ModerationOutcomeService)
    @optional()
    moderationOutcomeService?: IModerationOutcomeService,
    @inject(TYPES.ModerationQueueService)
    @optional()
    moderationQueueService?: IModerationQueueService,
    @inject(TYPES.RoleQuarantineService)
    @optional()
    roleQuarantineService?: IRoleQuarantineService
  ) {
    this.serverMemberRepository = serverMemberRepository;
    this.notificationManager = notificationManager;
    this.roleManager = roleManager;
    this.verificationEventRepository = verificationEventRepository;
    this.adminActionService = adminActionService;
    this.threadManager = threadManager;
    this.productAnalyticsService = productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE;
    this.moderationOutcomeService = moderationOutcomeService;
    this.moderationQueueService = moderationQueueService;
    this.roleQuarantineService = roleQuarantineService;
  }

  private async deleteLiveQueueCaseMirror(verificationEventId: string): Promise<void> {
    if (!this.moderationQueueService) {
      return;
    }

    try {
      await this.moderationQueueService.deleteCaseMirror(verificationEventId);
    } catch (error) {
      console.warn(
        `Failed to delete case ${verificationEventId} from the live moderation queue:`,
        error
      );
    }
  }

  private async refreshLiveQueueCaseMirror(verificationEvent: VerificationEvent): Promise<void> {
    if (!this.moderationQueueService) {
      return;
    }

    try {
      await this.moderationQueueService.upsertCaseMirror(verificationEvent);
    } catch (error) {
      console.warn(
        `Failed to refresh case ${verificationEvent.id} in the live moderation queue:`,
        error
      );
    }
  }

  private async refreshCaseNotification(verificationEvent: VerificationEvent): Promise<void> {
    if (!verificationEvent.notification_message_id) {
      return;
    }

    try {
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        verificationEvent.status
      );
    } catch (error) {
      console.warn(`Failed to refresh case notification ${verificationEvent.id}:`, error);
    }
  }

  private buildRoleQuarantineApplyMetadata(
    result: RoleQuarantineApplyResult
  ): Record<string, unknown> | null {
    if (result.status === 'off') {
      return null;
    }

    return {
      status: result.status,
      mode: result.mode,
      snapshot_id: result.snapshotId,
      original_role_count: result.originalRoleIds.length,
      planned_role_count: result.plannedRoleIds.length,
      removed_role_count: result.removedRoleIds.length,
      skipped_role_count: result.skippedRoles.length,
      failed_removal_count: result.failedRemovals.length,
      removed_role_ids: result.removedRoleIds,
      skipped_roles: result.skippedRoles,
      failed_removals: result.failedRemovals,
      at: new Date().toISOString(),
    };
  }

  private buildRoleQuarantineRestoreMetadata(
    result: RoleQuarantineRestoreResult
  ): Record<string, unknown> | null {
    if (result.status === 'no_active_snapshot') {
      return null;
    }

    return {
      status: result.status,
      snapshot_id: result.snapshotId,
      attempted_role_count: result.attemptedRoleIds.length,
      restored_role_count: result.restoredRoleIds.length,
      skipped_role_count: result.skippedRoles.length,
      failed_restore_count: result.failedRestores.length,
      restored_role_ids: result.restoredRoleIds,
      skipped_roles: result.skippedRoles,
      failed_restores: result.failedRestores,
      at: new Date().toISOString(),
    };
  }

  private withRoleQuarantineMetadata(
    metadata: VerificationEvent['metadata'],
    phase: 'restriction' | 'restore',
    details: Record<string, unknown>
  ): VerificationEvent['metadata'] {
    const record = this.metadataToRecord(metadata);
    const existing = record.role_quarantine;
    const existingRecord =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};

    return {
      ...record,
      role_quarantine: {
        ...existingRecord,
        [phase]: details,
      },
    } as VerificationEvent['metadata'];
  }

  private async updateRoleQuarantineMetadata(
    verificationEvent: VerificationEvent,
    phase: 'restriction' | 'restore',
    details: Record<string, unknown>
  ): Promise<VerificationEvent> {
    const metadata = this.withRoleQuarantineMetadata(verificationEvent.metadata, phase, details);
    const fallbackEvent = {
      ...verificationEvent,
      metadata,
    };

    try {
      return (
        (await this.verificationEventRepository.update(verificationEvent.id, { metadata })) ??
        fallbackEvent
      );
    } catch (error) {
      console.warn(
        `Failed to record role quarantine metadata for verification event ${verificationEvent.id}:`,
        error
      );
      return fallbackEvent;
    }
  }

  private async recordRoleQuarantineFailure(
    verificationEvent: VerificationEvent,
    error: unknown
  ): Promise<VerificationEvent> {
    const metadata = appendVerificationActionFailure(verificationEvent.metadata, {
      action: 'role_quarantine',
      message: this.formatError(error),
      at: new Date().toISOString(),
    });
    const fallbackEvent = {
      ...verificationEvent,
      metadata: metadata as VerificationEvent['metadata'],
    };

    try {
      return (
        (await this.verificationEventRepository.update(verificationEvent.id, {
          metadata: metadata as VerificationEvent['metadata'],
        })) ?? fallbackEvent
      );
    } catch (recordError) {
      console.warn(
        `Failed to record role quarantine failure for verification event ${verificationEvent.id}:`,
        recordError
      );
      return fallbackEvent;
    }
  }

  private async tryApplyRoleQuarantine(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<{ verificationEvent: VerificationEvent; metadata: Record<string, unknown> | null }> {
    if (!this.roleQuarantineService) {
      return { verificationEvent, metadata: null };
    }

    try {
      const result = await this.roleQuarantineService.quarantineMember(
        member,
        verificationEvent,
        moderator
      );
      const metadata = this.buildRoleQuarantineApplyMetadata(result);
      if (!metadata) {
        return { verificationEvent, metadata: null };
      }

      return {
        verificationEvent: await this.updateRoleQuarantineMetadata(
          verificationEvent,
          'restriction',
          metadata
        ),
        metadata,
      };
    } catch (error) {
      console.error(
        `Failed to quarantine roles for ${member.user.tag}; continuing case-role application:`,
        error
      );
      return {
        verificationEvent: await this.recordRoleQuarantineFailure(verificationEvent, error),
        metadata: {
          status: 'failed',
          message: this.formatError(error),
          at: new Date().toISOString(),
        },
      };
    }
  }

  private async tryRestoreRoleQuarantine(
    member: GuildMember,
    verificationEvent: VerificationEvent | null,
    moderator?: User
  ): Promise<{
    verificationEvent: VerificationEvent | null;
    metadata: Record<string, unknown> | null;
  }> {
    if (!this.roleQuarantineService) {
      return { verificationEvent, metadata: null };
    }

    try {
      const result = await this.roleQuarantineService.restoreMemberRoles(member, moderator);
      const metadata = this.buildRoleQuarantineRestoreMetadata(result);
      if (!metadata || !verificationEvent) {
        return { verificationEvent, metadata };
      }

      return {
        verificationEvent: await this.updateRoleQuarantineMetadata(
          verificationEvent,
          'restore',
          metadata
        ),
        metadata,
      };
    } catch (error) {
      console.error(
        `Failed to restore quarantined roles for ${member.user.tag}; continuing:`,
        error
      );
      if (!verificationEvent) {
        return {
          verificationEvent,
          metadata: {
            status: 'failed',
            message: this.formatError(error),
            at: new Date().toISOString(),
          },
        };
      }

      return {
        verificationEvent: await this.recordRoleQuarantineFailure(verificationEvent, error),
        metadata: {
          status: 'failed',
          message: this.formatError(error),
          at: new Date().toISOString(),
        },
      };
    }
  }

  private async tryAbandonRoleQuarantine(
    guildId: string,
    userId: string,
    reason: string,
    actorId?: string | null
  ): Promise<void> {
    if (!this.roleQuarantineService) {
      return;
    }

    try {
      await this.roleQuarantineService.abandonActiveSnapshot(guildId, userId, reason, actorId);
    } catch (error) {
      console.warn(`Failed to abandon role quarantine snapshot for ${userId}:`, error);
    }
  }

  private shouldRollbackRoleQuarantine(metadata: Record<string, unknown> | null): boolean {
    return (
      metadata !== null &&
      metadata.status === 'quarantined' &&
      typeof metadata.snapshot_id === 'string'
    );
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || 'Unknown error');
  }

  private captureModerationAction(
    member: GuildMember,
    actionType: AdminActionType,
    moderator?: User,
    verificationEventId?: string | null,
    detectionEventId?: string | null
  ): void {
    void this.productAnalyticsService.captureUserEvent(
      member.guild.id,
      member.id,
      'moderation action completed',
      { action_type: actionType },
      {
        moderatorId: moderator?.id,
        verificationEventId: verificationEventId ?? undefined,
        detectionEventId: detectionEventId ?? undefined,
      }
    );
  }

  private async getPendingVerificationEvents(
    member: GuildMember | PartialGuildMember
  ): Promise<VerificationEvent[]> {
    const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
      member.id,
      member.guild.id
    );
    return verificationEvents.filter((event) => event.status === VerificationStatus.PENDING);
  }

  private getModerationTarget(member: GuildMember | PartialGuildMember): ModerationTarget {
    return {
      guildId: member.guild.id,
      userId: member.id,
      userTag: member.user.tag,
      username: member.user.username,
      accountCreatedAt: this.getUserAccountCreatedAt(member.user),
    };
  }

  private getUserAccountCreatedAt(user: User): Date | null {
    const createdTimestamp = (user as { createdTimestamp?: unknown }).createdTimestamp;
    if (typeof createdTimestamp !== 'number' || !Number.isFinite(createdTimestamp)) {
      return null;
    }

    return new Date(createdTimestamp);
  }

  private async recordModerationOutcomes(
    target: ModerationTarget,
    outcomeType: ModerationOutcomeType,
    source: ModerationOutcomeSource,
    verificationEvents: VerificationEvent[],
    options: {
      actorId?: string | null;
      reason?: string | null;
      detectionEventId?: string | null;
      metadata?: Record<string, unknown>;
      occurredAt?: Date;
      recordWithoutVerificationEvent?: boolean;
    } = {}
  ): Promise<void> {
    const moderationOutcomeService = this.moderationOutcomeService;
    if (!moderationOutcomeService) {
      return;
    }

    const eventRecords = verificationEvents.length > 0 ? verificationEvents : [null];
    if (!options.recordWithoutVerificationEvent && verificationEvents.length === 0) {
      return;
    }

    await Promise.all(
      eventRecords.map((event) =>
        moderationOutcomeService.recordOutcome({
          server_id: target.guildId,
          user_id: target.userId,
          detection_event_id: options.detectionEventId ?? event?.detection_event_id ?? null,
          verification_event_id: event?.id ?? null,
          outcome_type: outcomeType,
          source,
          actor_id: options.actorId ?? null,
          reason: options.reason ?? null,
          occurred_at: options.occurredAt ?? null,
          metadata: (options.metadata ?? {}) as ModerationOutcomeRecordInput['metadata'],
          username: target.username,
          accountCreatedAt: target.accountCreatedAt,
        })
      )
    );
  }

  private async tryRecordModerationOutcomes(
    target: ModerationTarget,
    outcomeType: ModerationOutcomeType,
    source: ModerationOutcomeSource,
    verificationEvents: VerificationEvent[],
    options: Parameters<UserModerationService['recordModerationOutcomes']>[4] = {}
  ): Promise<void> {
    try {
      await this.recordModerationOutcomes(target, outcomeType, source, verificationEvents, options);
    } catch (error) {
      console.warn(
        `Failed to record ${outcomeType} moderation outcome for ${target.userId} in guild ${target.guildId}:`,
        error
      );
    }
  }

  private buildOutcomeMetadata(
    metadata: Record<string, unknown> = {},
    user?: User,
    member?: GuildMember | PartialGuildMember
  ): Record<string, unknown> {
    return {
      ...metadata,
      ...(user ? { user_snapshot: this.buildUserSnapshot(user, member) } : {}),
    };
  }

  private buildExternalResolutionActorLabel(
    source: ModerationOutcomeSource,
    actorId?: string | null
  ): string {
    if (actorId) {
      return actorId;
    }

    switch (source) {
      case ModerationOutcomeSource.NATIVE_DISCORD:
        return 'Discord native moderation';
      case ModerationOutcomeSource.EXTERNAL_BOT:
        return 'external Discord bot';
      case ModerationOutcomeSource.MIGRATION_OR_SYNC:
        return 'existing Discord ban sync';
      case ModerationOutcomeSource.UNKNOWN_EXTERNAL:
        return 'external Discord moderation';
      case ModerationOutcomeSource.DRASIL:
        return 'Drasil';
    }
  }

  private async finalizeExternallyResolvedVerificationEvent(
    verificationEvent: VerificationEvent,
    newStatus: VerificationStatus.BANNED | VerificationStatus.KICKED,
    source: ModerationOutcomeSource,
    actorId?: string | null
  ): Promise<void> {
    await this.threadManager.resolveVerificationThread(
      verificationEvent,
      newStatus,
      this.buildExternalResolutionActorLabel(source, actorId)
    );

    if (verificationEvent.notification_message_id) {
      try {
        await this.notificationManager.updateNotificationButtons(verificationEvent, newStatus);
      } catch (error) {
        console.warn(
          `Failed to update notification buttons for externally resolved case ${verificationEvent.id}:`,
          error
        );
      }
    }

    await this.deleteLiveQueueCaseMirror(verificationEvent.id);
  }

  private async finalizeResolvedVerificationEvent(
    target: ModerationTarget,
    verificationEvent: VerificationEvent,
    previousStatus: VerificationStatus,
    newStatus: ResolvedVerificationStatus,
    moderator: User,
    strictNotification: boolean,
    options: {
      notes?: string | null;
      detectionEventId?: string | null;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    const actionType = getResolutionAdminActionType(newStatus);

    await this.threadManager.resolveVerificationThread(verificationEvent, newStatus, moderator.id);

    const logged = await this.notificationManager.logActionToMessage(
      verificationEvent,
      actionType,
      moderator
    );
    if (!logged && strictNotification) {
      throw new Error(`Failed to log ${actionType} action for ${target.userTag}`);
    }

    if (verificationEvent.notification_message_id || strictNotification) {
      try {
        await this.notificationManager.updateNotificationButtons(verificationEvent, newStatus);
      } catch (error) {
        if (strictNotification) {
          throw error;
        }
        console.warn(
          `Failed to update notification buttons for duplicate resolved case ${verificationEvent.id}:`,
          error
        );
      }
    }

    await this.adminActionService.recordAction({
      server_id: target.guildId,
      user_id: target.userId,
      admin_id: moderator.id,
      verification_event_id: verificationEvent.id,
      detection_event_id: options.detectionEventId,
      action_type: actionType,
      previous_status: previousStatus,
      new_status: newStatus,
      notes: options.notes ?? null,
      metadata: options.metadata as unknown as Prisma.JsonValue | undefined,
    });

    await this.deleteLiveQueueCaseMirror(verificationEvent.id);
  }

  /**
   * Applies the case role and updates the active case state.
   */
  public async applyCaseRole(member: GuildMember, moderator?: User): Promise<boolean> {
    try {
      let verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );
      let roleQuarantineMetadata: Record<string, unknown> | null = null;

      if (!verificationEvent) {
        console.warn(`ApplyCaseRole called for ${member.user.tag} but no active case was found.`);
      } else if (verificationEvent.status !== VerificationStatus.PENDING) {
        verificationEvent.status = VerificationStatus.PENDING;
        await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);
      }

      if (verificationEvent) {
        const quarantineResult = await this.tryApplyRoleQuarantine(
          member,
          verificationEvent,
          moderator
        );
        verificationEvent = quarantineResult.verificationEvent;
        roleQuarantineMetadata = quarantineResult.metadata;
      }

      const rollbackRoleQuarantine = async (): Promise<void> => {
        if (!verificationEvent || !this.shouldRollbackRoleQuarantine(roleQuarantineMetadata)) {
          return;
        }

        const rollbackResult = await this.tryRestoreRoleQuarantine(
          member,
          verificationEvent,
          moderator
        );
        verificationEvent = rollbackResult.verificationEvent ?? verificationEvent;
      };

      let roleAssigned: boolean;
      try {
        roleAssigned = await this.roleManager.assignCaseRole(member);
      } catch (assignError) {
        await rollbackRoleQuarantine();
        throw assignError;
      }
      if (!roleAssigned) {
        await rollbackRoleQuarantine();
        throw new Error(`Failed to assign case role to ${member.user.tag}`);
      }

      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        case_role_active: true,
        verification_status: VerificationStatus.PENDING,
        last_status_change: new Date(),
        updated_by: moderator?.id,
      });

      console.log(`Successfully applied case role to ${member.user.tag}`);
      return true;
    } catch (error) {
      console.error(`Failed to apply case role to ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async restrictUser(member: GuildMember, moderator?: User): Promise<boolean> {
    try {
      let verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );
      const previousStatus = verificationEvent?.status ?? null;
      let roleQuarantineMetadata: Record<string, unknown> | null = null;

      if (!verificationEvent) {
        // If no active event, we might still need to apply the role based on other logic,
        // but for now, legacy calls are expected to happen only with an active event.
        // Alternatively, create a new PENDING event here? Needs clarification.
        console.warn(
          `RestrictUser called for ${member.user.tag} but no active verification event found.`
        );
        // Let's try assigning the role anyway, assuming the legacy intent is case-role application.
        // return false;
      } else {
        // Update existing event status if needed (e.g., if it was reopened)
        if (verificationEvent.status !== VerificationStatus.PENDING) {
          verificationEvent.status = VerificationStatus.PENDING;
          await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);
        }
      }

      if (verificationEvent) {
        const quarantineResult = await this.tryApplyRoleQuarantine(
          member,
          verificationEvent,
          moderator
        );
        verificationEvent = quarantineResult.verificationEvent;
        roleQuarantineMetadata = quarantineResult.metadata;
      }

      const rollbackRoleQuarantine = async (): Promise<void> => {
        if (!verificationEvent || !this.shouldRollbackRoleQuarantine(roleQuarantineMetadata)) {
          return;
        }

        const rollbackResult = await this.tryRestoreRoleQuarantine(
          member,
          verificationEvent,
          moderator
        );
        verificationEvent = rollbackResult.verificationEvent ?? verificationEvent;
      };

      // Assign the role using RoleManager
      let roleAssigned: boolean;
      try {
        roleAssigned = await this.roleManager.assignCaseRole(member);
      } catch (assignError) {
        await rollbackRoleQuarantine();
        throw assignError;
      }
      if (!roleAssigned) {
        await rollbackRoleQuarantine();
        throw new Error(`Failed to assign case role to ${member.user.tag}`);
      }

      // Update server member record
      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        case_role_active: true,
        verification_status: VerificationStatus.PENDING, // Ensure status matches
        last_status_change: new Date(),
        updated_by: moderator?.id,
      });

      console.log(`Successfully applied case role to ${member.user.tag}`);
      this.captureModerationAction(
        member,
        AdminActionType.RESTRICT,
        undefined,
        verificationEvent?.id,
        verificationEvent?.detection_event_id
      );
      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        ModerationOutcomeType.RESTRICTED,
        ModerationOutcomeSource.DRASIL,
        verificationEvent ? [verificationEvent] : [],
        {
          actorId: moderator?.id,
          metadata: this.buildOutcomeMetadata(
            roleQuarantineMetadata ? { role_quarantine: roleQuarantineMetadata } : {},
            member.user,
            member
          ),
          recordWithoutVerificationEvent: !verificationEvent,
        }
      );
      if (moderator && verificationEvent) {
        if (verificationEvent.notification_message_id) {
          await this.notificationManager.logActionToMessage(
            verificationEvent,
            AdminActionType.RESTRICT,
            moderator
          );
        }
        await this.adminActionService.recordAction({
          server_id: member.guild.id,
          user_id: member.id,
          admin_id: moderator.id,
          verification_event_id: verificationEvent.id,
          detection_event_id: verificationEvent.detection_event_id,
          action_type: AdminActionType.RESTRICT,
          previous_status: previousStatus,
          new_status: VerificationStatus.PENDING,
          notes: 'Case role applied while case remains pending.',
          metadata: roleQuarantineMetadata
            ? ({ role_quarantine: roleQuarantineMetadata } as unknown as Prisma.JsonValue)
            : undefined,
        });
      }
      return true;
    } catch (error) {
      console.error(`Failed to apply case role to ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async liftRestriction(member: GuildMember, moderator: User): Promise<boolean> {
    try {
      let verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );
      if (!verificationEvent) {
        throw new Error('No active verification event found to remove case role');
      }

      const serverMember = await this.serverMemberRepository.findByServerAndUser(
        member.guild.id,
        member.id
      );
      if (serverMember?.case_role_active !== true) {
        return true;
      }

      const roleRemoved = await this.roleManager.removeCaseRole(member);
      if (!roleRemoved) {
        throw new Error(`Failed to remove case role from ${member.user.tag}`);
      }

      const restoreResult = await this.tryRestoreRoleQuarantine(
        member,
        verificationEvent,
        moderator
      );
      verificationEvent = restoreResult.verificationEvent ?? verificationEvent;

      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        case_role_active: false,
        verification_status: VerificationStatus.PENDING,
        last_status_change: new Date(),
        updated_by: moderator.id,
      });

      await this.adminActionService.recordAction({
        server_id: member.guild.id,
        user_id: member.id,
        admin_id: moderator.id,
        verification_event_id: verificationEvent.id,
        detection_event_id: verificationEvent.detection_event_id,
        action_type: AdminActionType.LIFT_RESTRICTION,
        previous_status: verificationEvent.status,
        new_status: VerificationStatus.PENDING,
        notes: 'Case role removed while case remains pending.',
        metadata: restoreResult.metadata
          ? ({ role_quarantine: restoreResult.metadata } as unknown as Prisma.JsonValue)
          : undefined,
      });

      if (verificationEvent.notification_message_id) {
        await this.notificationManager.logActionToMessage(
          verificationEvent,
          AdminActionType.LIFT_RESTRICTION,
          moderator
        );
      }

      this.captureModerationAction(
        member,
        AdminActionType.LIFT_RESTRICTION,
        moderator,
        verificationEvent.id,
        verificationEvent.detection_event_id
      );
      return true;
    } catch (error) {
      console.error(`Failed to remove case role for user ${member.user.tag}:`, error);
      throw error;
    }
  }

  /**
   * Removes the case role from a guild member and updates their verification status
   * @param member The guild member to verify (unrestrict)
   * @param moderator The user who performed the verification
   * @returns Promise resolving to true if successful, false if the role couldn't be removed
   */
  public async verifyUser(member: GuildMember, moderator: User): Promise<boolean> {
    try {
      const pendingVerificationEvents = await this.getPendingVerificationEvents(member);
      const verificationEvent =
        pendingVerificationEvents.length > 0 ? pendingVerificationEvents[0] : null;

      if (!verificationEvent) {
        throw new Error('No active verification event found to verify');
      }

      const resolvedAt = new Date();
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.VERIFIED,
          resolved_by: moderator.id,
          resolved_at: resolvedAt,
          metadata: this.withUserSnapshot(pendingEvent.metadata, member.user, member),
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );

        if (!updatedEvent) {
          throw new Error(
            `Failed to update verification event ${pendingEvent.id} status to VERIFIED.`
          );
        }

        resolvedEvents.push({ event: updatedEvent, previousStatus });
      }

      const roleRemoved = await this.roleManager.removeCaseRole(member);
      if (!roleRemoved) {
        throw new Error(`Failed to remove case role from ${member.user.tag}`);
      }

      const restoreResult = await this.tryRestoreRoleQuarantine(
        member,
        resolvedEvents[0]?.event ?? verificationEvent,
        moderator
      );
      if (restoreResult.verificationEvent) {
        const restoredEventIndex = resolvedEvents.findIndex(
          (resolvedEvent) => resolvedEvent.event.id === restoreResult.verificationEvent?.id
        );
        if (restoredEventIndex >= 0) {
          resolvedEvents[restoredEventIndex] = {
            ...resolvedEvents[restoredEventIndex],
            event: restoreResult.verificationEvent,
          };
        }
      }

      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        case_role_active: false,
        verification_status: VerificationStatus.VERIFIED,
        last_status_change: new Date(),
        last_verified_at: new Date().toISOString(),
      });

      for (const resolvedEvent of resolvedEvents) {
        await this.finalizeResolvedVerificationEvent(
          this.getModerationTarget(member),
          resolvedEvent.event,
          resolvedEvent.previousStatus,
          VerificationStatus.VERIFIED,
          moderator,
          resolvedEvent.event.id === verificationEvent.id,
          {
            metadata: restoreResult.metadata
              ? { role_quarantine: restoreResult.metadata }
              : undefined,
          }
        );
      }

      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        getResolutionModerationOutcomeType(VerificationStatus.VERIFIED),
        ModerationOutcomeSource.DRASIL,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: moderator.id,
          metadata: this.buildOutcomeMetadata(
            restoreResult.metadata ? { role_quarantine: restoreResult.metadata } : {},
            member.user,
            member
          ),
        }
      );

      console.log(`User ${member.user.tag} verification process completed successfully.`);
      this.captureModerationAction(
        member,
        AdminActionType.VERIFY,
        moderator,
        verificationEvent.id,
        verificationEvent.detection_event_id
      );
      return true; // Verification process completed successfully
    } catch (error) {
      console.error(`Failed to verify user ${member.user.tag}:`, error);
      throw error;
    }
  }

  /**
   * Bans a user from the guild
   * @param member The guild member to ban
   * @param reason The reason for the ban
   * @param moderator The user who performed the ban
   * @returns Promise resolving to true if successful, false if the user couldn't be banned
   */
  public async banUser(
    member: GuildMember,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean> {
    try {
      const pendingVerificationEvents = await this.getPendingVerificationEvents(member);
      const verificationEvent =
        pendingVerificationEvents.length > 0 ? pendingVerificationEvents[0] : null;
      const resolvedAt = new Date();
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.BANNED,
          resolved_by: moderator.id,
          resolved_at: resolvedAt,
          notes: reason,
          metadata: this.withUserSnapshot(pendingEvent.metadata, member.user, member),
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        if (!updatedEvent) {
          console.warn(
            `Failed to update verification event ${pendingEvent.id} status to BANNED, but proceeding with ban.`
          );
          resolvedEvents.push({ event: eventToUpdate, previousStatus });
          continue;
        }

        resolvedEvents.push({ event: updatedEvent, previousStatus });
      }

      // Perform the ban
      await member.ban({ reason });
      console.log(`Banned user ${member.user.tag}. Reason: ${reason}`);
      await this.tryAbandonRoleQuarantine(member.guild.id, member.id, 'drasil_ban', moderator.id);

      try {
        // Update server member status
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          verification_status: VerificationStatus.BANNED,
          case_role_active: false,
          last_status_change: new Date(),
        });

        for (const resolvedEvent of resolvedEvents) {
          await this.finalizeResolvedVerificationEvent(
            this.getModerationTarget(member),
            resolvedEvent.event,
            resolvedEvent.previousStatus,
            VerificationStatus.BANNED,
            moderator,
            resolvedEvent.event.id === verificationEvent?.id,
            {
              notes: reason,
              detectionEventId: detectionEventId ?? resolvedEvent.event.detection_event_id,
            }
          );
        }
      } catch (postBanError) {
        console.error(
          `Ban succeeded for ${member.user.tag}, but post-ban updates failed:`,
          postBanError
        );
      }

      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        getResolutionModerationOutcomeType(VerificationStatus.BANNED),
        ModerationOutcomeSource.DRASIL,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: moderator.id,
          reason,
          detectionEventId: detectionEventId ?? verificationEvent?.detection_event_id ?? null,
          metadata: this.buildOutcomeMetadata({}, member.user, member),
          recordWithoutVerificationEvent: true,
        }
      );

      this.captureModerationAction(
        member,
        AdminActionType.BAN,
        moderator,
        verificationEvent?.id,
        detectionEventId ?? verificationEvent?.detection_event_id
      );
      return true; // Ban succeeded
    } catch (error) {
      console.error(`Failed to ban user ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async kickUser(
    member: GuildMember,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean> {
    try {
      const pendingVerificationEvents = await this.getPendingVerificationEvents(member);
      const verificationEvent =
        pendingVerificationEvents.length > 0 ? pendingVerificationEvents[0] : null;
      const resolvedAt = new Date();

      await member.kick(reason);
      console.log(`Kicked user ${member.user.tag}. Reason: ${reason}`);
      await this.tryAbandonRoleQuarantine(member.guild.id, member.id, 'drasil_kick', moderator.id);

      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      try {
        for (const pendingEvent of pendingVerificationEvents) {
          const previousStatus = pendingEvent.status;
          const eventToUpdate = {
            ...pendingEvent,
            status: VerificationStatus.KICKED,
            resolved_by: moderator.id,
            resolved_at: resolvedAt,
            notes: reason,
            metadata: this.withUserSnapshot(pendingEvent.metadata, member.user, member),
          };
          const updatedEvent = await this.verificationEventRepository.update(
            pendingEvent.id,
            eventToUpdate
          );
          resolvedEvents.push({ event: updatedEvent ?? eventToUpdate, previousStatus });
        }

        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          verification_status: VerificationStatus.KICKED,
          case_role_active: false,
          last_status_change: new Date(),
        });

        for (const resolvedEvent of resolvedEvents) {
          await this.finalizeResolvedVerificationEvent(
            this.getModerationTarget(member),
            resolvedEvent.event,
            resolvedEvent.previousStatus,
            VerificationStatus.KICKED,
            moderator,
            resolvedEvent.event.id === verificationEvent?.id,
            {
              notes: reason,
              detectionEventId: detectionEventId ?? resolvedEvent.event.detection_event_id,
            }
          );
        }
      } catch (postKickError) {
        console.error(
          `Kick succeeded for ${member.user.tag}, but post-kick updates failed:`,
          postKickError
        );
        throw postKickError;
      }

      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        getResolutionModerationOutcomeType(VerificationStatus.KICKED),
        ModerationOutcomeSource.DRASIL,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: moderator.id,
          reason,
          detectionEventId: detectionEventId ?? verificationEvent?.detection_event_id ?? null,
          metadata: this.buildOutcomeMetadata({}, member.user, member),
          recordWithoutVerificationEvent: true,
        }
      );

      this.captureModerationAction(
        member,
        AdminActionType.KICK,
        moderator,
        verificationEvent?.id,
        detectionEventId ?? verificationEvent?.detection_event_id
      );
      return true;
    } catch (error) {
      console.error(`Failed to kick user ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async banUserById(
    guild: Guild,
    userId: string,
    reason: string,
    moderator: User,
    detectionEventId?: string
  ): Promise<boolean> {
    try {
      const targetUser = await guild.client.users.fetch(userId).catch(() => null);
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        userId,
        guild.id
      );
      const pendingVerificationEvents = verificationEvents.filter(
        (event) => event.status === VerificationStatus.PENDING
      );
      const resolvedAt = new Date();
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousEvent: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.BANNED,
          resolved_by: moderator.id,
          resolved_at: resolvedAt,
          notes: reason,
          metadata: {
            ...this.metadataToRecord(pendingEvent.metadata),
            ...(targetUser ? { user_snapshot: this.buildUserSnapshot(targetUser) } : {}),
            membership_state: 'left_or_removed',
            banned_by_id_at: resolvedAt.toISOString(),
          } as VerificationEvent['metadata'],
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        resolvedEvents.push({
          event: updatedEvent ?? eventToUpdate,
          previousEvent: pendingEvent,
          previousStatus,
        });
      }

      try {
        await guild.bans.create(targetUser ?? userId, { reason });
      } catch (banError) {
        for (const resolvedEvent of resolvedEvents) {
          await this.verificationEventRepository
            .update(resolvedEvent.previousEvent.id, resolvedEvent.previousEvent)
            .catch((rollbackError) => {
              console.warn(
                `Failed to roll back case ${resolvedEvent.previousEvent.id} after ban by ID failed:`,
                rollbackError
              );
            });
        }

        throw banError;
      }

      console.log(`Banned user ${targetUser?.tag ?? userId} by ID. Reason: ${reason}`);
      await this.tryAbandonRoleQuarantine(guild.id, userId, 'drasil_ban_by_id', moderator.id);

      try {
        await this.serverMemberRepository.upsertMember(guild.id, userId, {
          verification_status: VerificationStatus.BANNED,
          case_role_active: false,
          last_status_change: resolvedAt,
        });

        const target: ModerationTarget = {
          guildId: guild.id,
          userId,
          userTag: targetUser?.tag ?? userId,
          username: targetUser?.username ?? null,
          accountCreatedAt: targetUser ? this.getUserAccountCreatedAt(targetUser) : null,
        };

        for (const resolvedEvent of resolvedEvents) {
          await this.finalizeResolvedVerificationEvent(
            target,
            resolvedEvent.event,
            resolvedEvent.previousStatus,
            VerificationStatus.BANNED,
            moderator,
            Boolean(resolvedEvent.event.notification_message_id) &&
              resolvedEvent.event.id === resolvedEvents[0]?.event.id,
            {
              notes: reason,
              detectionEventId: detectionEventId ?? resolvedEvent.event.detection_event_id,
              metadata: { source_detail: 'ban_by_id' },
            }
          );
        }

        await this.tryRecordModerationOutcomes(
          target,
          getResolutionModerationOutcomeType(VerificationStatus.BANNED),
          ModerationOutcomeSource.DRASIL,
          resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
          {
            actorId: moderator.id,
            reason,
            detectionEventId:
              detectionEventId ?? resolvedEvents[0]?.event.detection_event_id ?? null,
            metadata: this.buildOutcomeMetadata(
              { source_detail: 'ban_by_id' },
              targetUser ?? undefined
            ),
            recordWithoutVerificationEvent: true,
          }
        );

        void this.productAnalyticsService.captureUserEvent(
          guild.id,
          userId,
          'moderation action completed',
          { action_type: AdminActionType.BAN, source_detail: 'ban_by_id' },
          {
            moderatorId: moderator.id,
            verificationEventId: resolvedEvents[0]?.event.id,
            detectionEventId:
              detectionEventId ?? resolvedEvents[0]?.event.detection_event_id ?? undefined,
          }
        );
      } catch (postBanError) {
        console.error(
          `Ban by ID succeeded for ${targetUser?.tag ?? userId}, but post-ban updates failed:`,
          postBanError
        );
      }

      return true;
    } catch (error) {
      console.error(`Failed to ban user ${userId} by ID:`, error);
      throw error;
    }
  }

  public async syncAlreadyBannedUser(
    guild: Guild,
    userId: string,
    moderator: User
  ): Promise<number> {
    try {
      const existingBan = await guild.bans.fetch(userId).catch(() => null);
      if (!existingBan) {
        throw new Error(`User ${userId} is not banned in guild ${guild.id}`);
      }

      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        userId,
        guild.id
      );
      const pendingVerificationEvents = verificationEvents.filter(
        (event) => event.status === VerificationStatus.PENDING
      );
      if (pendingVerificationEvents.length === 0) {
        await this.tryAbandonRoleQuarantine(
          guild.id,
          userId,
          'sync_existing_discord_ban',
          moderator.id
        );
        return 0;
      }

      const existingBanReason = existingBan.reason?.trim() ?? '';
      const notes = existingBanReason
        ? `Synced existing Discord ban: ${existingBanReason}`
        : 'Synced existing Discord ban.';
      const resolvedAt = new Date();
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.BANNED,
          resolved_by: moderator.id,
          resolved_at: resolvedAt,
          notes,
          metadata: this.withUserSnapshot(pendingEvent.metadata, existingBan.user),
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        resolvedEvents.push({ event: updatedEvent ?? eventToUpdate, previousStatus });
      }

      await this.serverMemberRepository.upsertMember(guild.id, userId, {
        verification_status: VerificationStatus.BANNED,
        case_role_active: false,
        last_status_change: new Date(),
      });
      await this.tryAbandonRoleQuarantine(
        guild.id,
        userId,
        'sync_existing_discord_ban',
        moderator.id
      );

      const target = {
        guildId: guild.id,
        userId,
        userTag: existingBan.user.tag,
        username: existingBan.user.username,
        accountCreatedAt: this.getUserAccountCreatedAt(existingBan.user),
      };

      try {
        for (const resolvedEvent of resolvedEvents) {
          await this.finalizeResolvedVerificationEvent(
            target,
            resolvedEvent.event,
            resolvedEvent.previousStatus,
            VerificationStatus.BANNED,
            moderator,
            resolvedEvent.event.id === resolvedEvents[0].event.id,
            {
              notes,
              detectionEventId: resolvedEvent.event.detection_event_id,
            }
          );
        }
      } catch (postSyncError) {
        console.error(
          `Existing ban sync succeeded for ${target.userTag}, but post-sync updates failed:`,
          postSyncError
        );
      }

      await this.tryRecordModerationOutcomes(
        target,
        getResolutionModerationOutcomeType(VerificationStatus.BANNED),
        ModerationOutcomeSource.MIGRATION_OR_SYNC,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: moderator.id,
          reason: existingBanReason || null,
          metadata: this.buildOutcomeMetadata(
            {
              source_detail: 'syncAlreadyBannedUser',
              synced_already_banned: true,
            },
            existingBan.user
          ),
          occurredAt: resolvedAt,
        }
      );

      void this.productAnalyticsService.captureUserEvent(
        guild.id,
        userId,
        'moderation action completed',
        { action_type: AdminActionType.BAN, synced_already_banned: true },
        {
          moderatorId: moderator.id,
          verificationEventId: resolvedEvents[0].event.id,
          detectionEventId: resolvedEvents[0].event.detection_event_id ?? undefined,
        }
      );

      return resolvedEvents.length;
    } catch (error) {
      console.error(`Failed to sync already-banned user ${userId}:`, error);
      throw error;
    }
  }

  public async closeCaseNoAction(
    guild: Guild,
    userId: string,
    moderator: User,
    notes?: string | null
  ): Promise<number> {
    try {
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        userId,
        guild.id
      );
      const pendingVerificationEvents = verificationEvents.filter(
        (event) => event.status === VerificationStatus.PENDING
      );

      const member = await guild.members.fetch(userId).catch(() => null);
      const serverMember = await this.serverMemberRepository.findByServerAndUser(guild.id, userId);
      const shouldRemoveCaseRole = member && serverMember?.case_role_active === true;

      if (pendingVerificationEvents.length === 0) {
        if (shouldRemoveCaseRole) {
          const roleRemoved = await this.roleManager.removeCaseRole(member);
          if (!roleRemoved) {
            throw new Error(`Failed to remove case role from ${member.user.tag}`);
          }

          await this.tryRestoreRoleQuarantine(member, null, moderator);

          await this.serverMemberRepository.upsertMember(guild.id, userId, {
            case_role_active: false,
            verification_status: VerificationStatus.CLOSED_NO_ACTION,
            last_status_change: new Date(),
            updated_by: moderator.id,
          });
        } else if (!member) {
          await this.tryAbandonRoleQuarantine(
            guild.id,
            userId,
            'close_no_action_member_absent',
            moderator.id
          );
        }

        return 0;
      }

      const resolvedAt = new Date();
      const resolutionNotes = notes?.trim() || 'Closed with no action.';
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.CLOSED_NO_ACTION,
          resolved_by: moderator.id,
          resolved_at: resolvedAt,
          notes: resolutionNotes,
          metadata: {
            ...this.metadataToRecord(pendingEvent.metadata),
            ...(member ? { user_snapshot: this.buildUserSnapshot(member.user, member) } : {}),
            ...(!member ? { membership_state: 'left_or_removed' } : {}),
            closed_no_action_at: resolvedAt.toISOString(),
          } as VerificationEvent['metadata'],
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        resolvedEvents.push({ event: updatedEvent ?? eventToUpdate, previousStatus });
      }

      if (shouldRemoveCaseRole) {
        const roleRemoved = await this.roleManager.removeCaseRole(member);
        if (!roleRemoved) {
          throw new Error(`Failed to remove case role from ${member.user.tag}`);
        }
      }

      const restoreResult = member
        ? await this.tryRestoreRoleQuarantine(member, resolvedEvents[0]?.event ?? null, moderator)
        : { verificationEvent: null, metadata: null };
      if (!member) {
        await this.tryAbandonRoleQuarantine(
          guild.id,
          userId,
          'close_no_action_member_absent',
          moderator.id
        );
      }
      if (restoreResult.verificationEvent) {
        const restoredEventIndex = resolvedEvents.findIndex(
          (resolvedEvent) => resolvedEvent.event.id === restoreResult.verificationEvent?.id
        );
        if (restoredEventIndex >= 0) {
          resolvedEvents[restoredEventIndex] = {
            ...resolvedEvents[restoredEventIndex],
            event: restoreResult.verificationEvent,
          };
        }
      }

      await this.serverMemberRepository.upsertMember(guild.id, userId, {
        case_role_active: false,
        verification_status: VerificationStatus.CLOSED_NO_ACTION,
        last_status_change: resolvedAt,
        updated_by: moderator.id,
      });

      const target = member
        ? this.getModerationTarget(member)
        : {
            guildId: guild.id,
            userId,
            userTag: userId,
            username: null,
            accountCreatedAt: null,
          };

      for (const resolvedEvent of resolvedEvents) {
        await this.finalizeResolvedVerificationEvent(
          target,
          resolvedEvent.event,
          resolvedEvent.previousStatus,
          VerificationStatus.CLOSED_NO_ACTION,
          moderator,
          Boolean(resolvedEvent.event.notification_message_id) &&
            resolvedEvent.event.id === resolvedEvents[0].event.id,
          {
            notes: resolutionNotes,
            detectionEventId: resolvedEvent.event.detection_event_id,
            metadata: restoreResult.metadata
              ? { role_quarantine: restoreResult.metadata }
              : undefined,
          }
        );
      }

      await this.tryRecordModerationOutcomes(
        target,
        getResolutionModerationOutcomeType(VerificationStatus.CLOSED_NO_ACTION),
        ModerationOutcomeSource.DRASIL,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: moderator.id,
          reason: resolutionNotes,
          metadata: member
            ? this.buildOutcomeMetadata(
                restoreResult.metadata ? { role_quarantine: restoreResult.metadata } : {},
                member.user,
                member
              )
            : {},
        }
      );

      void this.productAnalyticsService.captureUserEvent(
        guild.id,
        userId,
        'moderation action completed',
        { action_type: AdminActionType.CLOSE_NO_ACTION },
        {
          moderatorId: moderator.id,
          verificationEventId: resolvedEvents[0].event.id,
          detectionEventId: resolvedEvents[0].event.detection_event_id ?? undefined,
        }
      );

      return resolvedEvents.length;
    } catch (error) {
      console.error(`Failed to close case with no action for user ${userId}:`, error);
      throw error;
    }
  }

  public async recordObservedDiscordBan(
    guild: Guild,
    user: User,
    options: ObservedDiscordBanOptions
  ): Promise<number> {
    try {
      if (options.source === ModerationOutcomeSource.DRASIL) {
        return 0;
      }

      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        user.id,
        guild.id
      );
      const pendingVerificationEvents = verificationEvents.filter(
        (event) => event.status === VerificationStatus.PENDING
      );
      if (pendingVerificationEvents.length === 0) {
        await this.tryAbandonRoleQuarantine(
          guild.id,
          user.id,
          'observed_discord_ban',
          options.actorId ?? null
        );
        return 0;
      }

      const resolvedAt = options.occurredAt ?? new Date();
      const notes = options.reason?.trim()
        ? `Observed Discord ban: ${options.reason.trim()}`
        : 'Observed Discord ban.';
      const outcomeMetadata = this.buildOutcomeMetadata(
        {
          source_detail: options.sourceDetail ?? 'guildBanAdd',
          audit_log_entry_id: options.auditLogEntryId ?? null,
        },
        user
      );
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.BANNED,
          resolved_by: options.actorId ?? null,
          resolved_at: resolvedAt,
          notes,
          metadata: {
            ...this.metadataToRecord(pendingEvent.metadata),
            ...outcomeMetadata,
            moderation_outcome_source: options.source,
            moderation_outcome_actor_id: options.actorId ?? null,
          } as VerificationEvent['metadata'],
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        resolvedEvents.push({ event: updatedEvent ?? eventToUpdate, previousStatus });
      }

      await this.serverMemberRepository.upsertMember(guild.id, user.id, {
        verification_status: VerificationStatus.BANNED,
        case_role_active: false,
        last_status_change: new Date(),
      });
      await this.tryAbandonRoleQuarantine(
        guild.id,
        user.id,
        'observed_discord_ban',
        options.actorId ?? null
      );

      for (const resolvedEvent of resolvedEvents) {
        await this.finalizeExternallyResolvedVerificationEvent(
          resolvedEvent.event,
          VerificationStatus.BANNED,
          options.source,
          options.actorId
        );
      }

      await this.tryRecordModerationOutcomes(
        {
          guildId: guild.id,
          userId: user.id,
          userTag: user.tag,
          username: user.username,
          accountCreatedAt: this.getUserAccountCreatedAt(user),
        },
        getResolutionModerationOutcomeType(VerificationStatus.BANNED),
        options.source,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: options.actorId ?? null,
          reason: options.reason ?? null,
          metadata: outcomeMetadata,
          occurredAt: resolvedAt,
        }
      );

      void this.productAnalyticsService.captureUserEvent(
        guild.id,
        user.id,
        'moderation action completed',
        { action_type: AdminActionType.BAN, source: options.source },
        {
          moderatorId: options.actorId ?? undefined,
          verificationEventId: resolvedEvents[0].event.id,
          detectionEventId: resolvedEvents[0].event.detection_event_id ?? undefined,
        }
      );

      return resolvedEvents.length;
    } catch (error) {
      console.error(`Failed to record observed Discord ban for user ${user.id}:`, error);
      throw error;
    }
  }

  public async recordObservedDiscordKick(
    member: GuildMember | PartialGuildMember,
    options: ObservedDiscordKickOptions
  ): Promise<number> {
    try {
      if (options.source === ModerationOutcomeSource.DRASIL) {
        return 0;
      }

      const pendingVerificationEvents = await this.getPendingVerificationEvents(member);
      const resolvedAt = options.occurredAt ?? new Date();
      const notes = options.reason?.trim()
        ? `Observed Discord kick: ${options.reason.trim()}`
        : 'Observed Discord kick.';
      const outcomeMetadata = this.buildOutcomeMetadata(
        {
          source_detail: options.sourceDetail ?? 'guildMemberRemove',
          audit_log_entry_id: options.auditLogEntryId ?? null,
          membership_state: 'kicked',
          kicked_at: resolvedAt.toISOString(),
        },
        member.user,
        member
      );
      const resolvedEvents: Array<{
        event: VerificationEvent;
        previousStatus: VerificationStatus;
      }> = [];

      for (const pendingEvent of pendingVerificationEvents) {
        const previousStatus = pendingEvent.status;
        const eventToUpdate = {
          ...pendingEvent,
          status: VerificationStatus.KICKED,
          resolved_by: options.actorId ?? null,
          resolved_at: resolvedAt,
          notes,
          metadata: {
            ...this.metadataToRecord(pendingEvent.metadata),
            ...outcomeMetadata,
            moderation_outcome_source: options.source,
            moderation_outcome_actor_id: options.actorId ?? null,
          } as VerificationEvent['metadata'],
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate
        );
        resolvedEvents.push({ event: updatedEvent ?? eventToUpdate, previousStatus });
      }

      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        verification_status: VerificationStatus.KICKED,
        case_role_active: false,
        last_status_change: new Date(),
      });
      await this.tryAbandonRoleQuarantine(
        member.guild.id,
        member.id,
        'observed_discord_kick',
        options.actorId ?? null
      );

      for (const resolvedEvent of resolvedEvents) {
        await this.finalizeExternallyResolvedVerificationEvent(
          resolvedEvent.event,
          VerificationStatus.KICKED,
          options.source,
          options.actorId
        );
      }

      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        getResolutionModerationOutcomeType(VerificationStatus.KICKED),
        options.source,
        resolvedEvents.map((resolvedEvent) => resolvedEvent.event),
        {
          actorId: options.actorId ?? null,
          reason: options.reason ?? null,
          metadata: outcomeMetadata,
          occurredAt: resolvedAt,
          recordWithoutVerificationEvent: true,
        }
      );

      void this.productAnalyticsService.captureUserEvent(
        member.guild.id,
        member.id,
        'moderation action completed',
        { action_type: AdminActionType.KICK, source: options.source },
        {
          moderatorId: options.actorId ?? undefined,
          verificationEventId: resolvedEvents[0]?.event.id,
          detectionEventId: resolvedEvents[0]?.event.detection_event_id ?? undefined,
        }
      );

      return resolvedEvents.length;
    } catch (error) {
      console.error(`Failed to record observed Discord kick for user ${member.id}:`, error);
      throw error;
    }
  }

  public async findLatestKickOutcome(
    serverId: string,
    userId: string
  ): Promise<ModerationOutcome | null> {
    return (
      (await this.moderationOutcomeService?.findLatestOutcomeByType(
        serverId,
        userId,
        getResolutionModerationOutcomeType(VerificationStatus.KICKED)
      )) ?? null
    );
  }

  public async recordMemberLeftGuild(member: GuildMember | PartialGuildMember): Promise<number> {
    try {
      const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
        member.id,
        member.guild.id
      );
      const pendingVerificationEvents = verificationEvents.filter(
        (event) => event.status === VerificationStatus.PENDING
      );
      const occurredAt = new Date();
      await this.serverMemberRepository.updateDiscordMemberPendingState(
        member.guild.id,
        member.id,
        false,
        occurredAt
      );
      await this.moderationQueueService
        ?.deletePendingScreeningMember(member.guild.id, member.id)
        .catch((error) => {
          console.warn(
            `Failed to delete pending-screening queue item for ${member.id} in guild ${member.guild.id}:`,
            error
          );
        });
      const outcomeMetadata = this.buildOutcomeMetadata(
        {
          source_detail: 'guildMemberRemove',
          membership_state: 'left_or_removed',
          removal_type: 'left_or_unknown',
          member_left_at: occurredAt.toISOString(),
        },
        member.user,
        member
      );
      const markedEvents: VerificationEvent[] = [];
      await this.tryAbandonRoleQuarantine(member.guild.id, member.id, 'member_left');

      for (const pendingEvent of pendingVerificationEvents) {
        const eventToUpdate = {
          ...pendingEvent,
          metadata: {
            ...this.metadataToRecord(pendingEvent.metadata),
            ...outcomeMetadata,
          } as VerificationEvent['metadata'],
        };
        const updatedEvent = await this.verificationEventRepository.update(
          pendingEvent.id,
          eventToUpdate,
          { touchUpdatedAt: false }
        );
        const markedEvent = updatedEvent ?? eventToUpdate;
        markedEvents.push(markedEvent);
        await this.refreshCaseNotification(markedEvent);
        await this.refreshLiveQueueCaseMirror(markedEvent);
      }

      await this.tryRecordModerationOutcomes(
        this.getModerationTarget(member),
        ModerationOutcomeType.MEMBER_LEFT,
        ModerationOutcomeSource.UNKNOWN_EXTERNAL,
        markedEvents,
        {
          metadata: outcomeMetadata,
          occurredAt,
          recordWithoutVerificationEvent: true,
        }
      );

      return markedEvents.length;
    } catch (error) {
      console.error(`Failed to record guild member removal for user ${member.id}:`, error);
      throw error;
    }
  }

  private withUserSnapshot(
    metadata: VerificationEvent['metadata'],
    user: User,
    member?: GuildMember
  ): VerificationEvent['metadata'] {
    return {
      ...this.metadataToRecord(metadata),
      user_snapshot: this.buildUserSnapshot(user, member),
    } as VerificationEvent['metadata'];
  }

  private buildUserSnapshot(
    user: User,
    member?: GuildMember | PartialGuildMember
  ): Record<string, string> {
    const snapshot: Record<string, string> = {
      id: user.id,
      tag: user.tag,
      username: user.username,
    };

    if (member?.displayName) {
      snapshot.display_name = member.displayName;
    }

    const createdTimestamp = (user as { createdTimestamp?: unknown }).createdTimestamp;
    if (typeof createdTimestamp === 'number' && Number.isFinite(createdTimestamp)) {
      snapshot.account_created_at = new Date(createdTimestamp).toISOString();
    }

    if (member?.joinedAt) {
      snapshot.joined_at = member.joinedAt.toISOString();
    }

    const displayAvatarURL = (user as { displayAvatarURL?: unknown }).displayAvatarURL;
    if (typeof displayAvatarURL === 'function') {
      const avatarUrl = (displayAvatarURL as () => string).call(user);
      if (avatarUrl) {
        snapshot.avatar_url = avatarUrl;
      }
    }

    return snapshot;
  }

  private metadataToRecord(metadata: VerificationEvent['metadata']): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...(metadata as Record<string, unknown>) };
  }
}
