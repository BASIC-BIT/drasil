import { injectable, inject } from 'inversify';
import { GuildMember, Message, Client, User, APIUser, InteractionContextType } from 'discord.js';
import { TYPES } from '../di/symbols';
import { INotificationManager } from './NotificationManager';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import {
  AdminActionType,
  DetectionEvent,
  DetectionType,
  VerificationEvent,
  VerificationStatus,
} from '../repositories/types';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IUserRepository } from '../repositories/UserRepository';
import {
  IThreadManager,
  REPORT_REVIEW_THREAD_TYPE,
  VERIFICATION_THREAD_TYPE_METADATA_KEY,
} from './ThreadManager';
import { IUserModerationService } from './UserModerationService';
import { IAdminActionService } from './AdminActionService';
import { getUserReportSettings } from '../utils/userReportSettings';
import { appendVerificationActionFailure } from '../utils/verificationActionFailures';
/**
 * Interface for the SecurityActionService
 */
export interface ISecurityActionService {
  /**
   * Handle the response to a suspicious message
   *
   * @param member The guild member who sent the message
   * @param detectionResult The detection result from the orchestrator
   * @param sourceMessage The original message that triggered the detection
   * @returns Whether the action was successfully executed
   */
  handleSuspiciousMessage(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<boolean>;

  /**
   * Handle the response to a suspicious new join
   *
   * @param member The guild member who joined
   * @param detectionResult The detection result from the orchestrator
   * @returns Whether the action was successfully executed
   */
  handleSuspiciousJoin(member: GuildMember, detectionResult: DetectionResult): Promise<boolean>;

  openCaseForSuspiciousMessage(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<boolean>;

  openCaseForSuspiciousJoin(
    member: GuildMember,
    detectionResult: DetectionResult
  ): Promise<boolean>;

  /**
   * Handle a manual flag initiated by an admin
   */
  handleManualFlag(member: GuildMember, moderator: User, reason?: string): Promise<boolean>;

  /**
   * Handle a user report submitted via modal
   */
  handleUserReport(member: GuildMember, reporter: User, reason?: string): Promise<boolean>;

  handleMessageReport(
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext
  ): Promise<boolean>;

  openObservedDetectionCase(
    member: GuildMember,
    detectionEventId: string,
    moderator: User
  ): Promise<boolean>;

  restrictObservedDetection(
    member: GuildMember,
    detectionEventId: string,
    moderator: User
  ): Promise<boolean>;

  banObservedDetection(
    member: GuildMember,
    detectionEventId: string,
    moderator: User,
    reason: string
  ): Promise<boolean>;

  dismissObservedDetection(
    guildId: string,
    userId: string,
    detectionEventId: string,
    moderator: User,
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE
  ): Promise<boolean>;

  undoObservedDetectionAction(
    guildId: string,
    userId: string,
    detectionEventId: string,
    moderator: User
  ): Promise<AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE | null>;

  /**
   * Reopens a verification event, and re-restricts the user (or unbans them?)
   * @param verificationEvent The verification event to reopen
   * @returns Whether the thread was successfully reopened
   */
  reopenVerification(verificationEvent: VerificationEvent, moderator: User): Promise<boolean>;
}

export interface MessageReportContext {
  messageId: string;
  channelId?: string;
  guildId?: string;
  content?: string;
  reason?: string;
  interactionContext?: InteractionContextType;
}

/**
 * SecurityActionService - Coordinates calls to various services based upon actions that occurred
 * This is the service to put all that fancy business logic
 */
@injectable()
export class SecurityActionService implements ISecurityActionService {
  private notificationManager: INotificationManager;
  private detectionEventsRepository: IDetectionEventsRepository;
  private serverMemberRepository: IServerMemberRepository;
  private verificationEventRepository: IVerificationEventRepository;
  private userRepository: IUserRepository;
  private serverRepository: IServerRepository;
  private adminActionService: IAdminActionService;
  private threadManager: IThreadManager;
  private userModerationService: IUserModerationService; // Keep for reopenVerification for now
  private client: Client;

  constructor(
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.AdminActionService) adminActionService: IAdminActionService,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService, // Keep for reopenVerification
    @inject(TYPES.DiscordClient) client: Client
  ) {
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.verificationEventRepository = verificationEventRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.adminActionService = adminActionService;
    this.threadManager = threadManager;
    this.userModerationService = userModerationService; // Keep for reopenVerification
    this.client = client;
  }

  /**
   * Ensures all required entities exist in the database
   * This should be called at the start of handling any security action
   */
  private async ensureEntitiesExist(
    serverId: string,
    userId: string,
    username?: string,
    joinedAt?: string
  ): Promise<void> {
    try {
      // First, ensure the server exists
      await this.serverRepository.getOrCreateServer(serverId);

      // Then, ensure the user exists
      await this.userRepository.getOrCreateUser(userId, username);

      // Finally, ensure server_member record exists
      // Pass Date object directly, or undefined if null
      await this.serverMemberRepository.getOrCreateMember(
        serverId,
        userId,
        joinedAt ? new Date(joinedAt) : undefined
      );
    } catch (error) {
      console.error('Failed to ensure entities exist:', error);
      throw error;
    }
  }

  /**
   * Record a detection event in the database
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param detectionResult The detection result
   * @param messageContent Optional message content that triggered the detection
   * @param messageId Optional message ID that triggered the detection
   * @param channelId Optional channel ID that triggered the detection
   * @returns The created DetectionEvent
   */
  private async recordDetectionEvent(
    serverId: string,
    userId: string,
    detectionResult: DetectionResult,
    messageContent?: string,
    messageId?: string,
    channelId?: string
  ): Promise<DetectionEvent> {
    return this.detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: detectionResult.triggerSource,
      confidence: detectionResult.confidence,
      reasons: detectionResult.reasons,
      detected_at: new Date(),
      message_id: messageId,
      channel_id: channelId,
      metadata: messageContent ? { content: messageContent } : undefined,
    });
  }

  /**
   * Ensure a detection event exists and return its ID.
   * If the detection result already includes an ID, reuse it.
   */
  private async ensureDetectionEventId(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<string> {
    if (detectionResult.detectionEventId) {
      return detectionResult.detectionEventId;
    }

    const createdEvent = await this.recordDetectionEvent(
      member.guild.id,
      member.id,
      detectionResult,
      sourceMessage?.content,
      sourceMessage?.id,
      sourceMessage?.channelId
    );

    detectionResult.detectionEventId = createdEvent.id;
    return createdEvent.id;
  }

  private async upsertNotification(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    sourceMessage?: Message
  ): Promise<void> {
    const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
      member,
      detectionResult,
      verificationEvent,
      sourceMessage
    );

    if (!notificationMessage) {
      throw new Error('Failed to send or update suspicious user notification');
    }

    if (verificationEvent.notification_message_id !== notificationMessage.id) {
      await this.verificationEventRepository.update(verificationEvent.id, {
        notification_message_id: notificationMessage.id,
      });
    }
  }

  private createDetectionResultFromEvent(detectionEvent: DetectionEvent): DetectionResult {
    const metadata =
      detectionEvent.metadata &&
      typeof detectionEvent.metadata === 'object' &&
      !Array.isArray(detectionEvent.metadata)
        ? detectionEvent.metadata
        : {};
    const content = typeof metadata.content === 'string' ? metadata.content : undefined;

    return {
      label: 'SUSPICIOUS',
      confidence: detectionEvent.confidence,
      reasons: detectionEvent.reasons,
      triggerSource: detectionEvent.detection_type,
      triggerContent: content ?? '',
      detectionEventId: detectionEvent.id,
    };
  }

  private shouldUseReportReviewThread(
    restrictUser: boolean,
    detectionResult: DetectionResult
  ): boolean {
    return !restrictUser && detectionResult.triggerSource === DetectionType.USER_REPORT;
  }

  private hasReportReviewThread(verificationEvent: VerificationEvent): boolean {
    const metadata =
      verificationEvent.metadata &&
      typeof verificationEvent.metadata === 'object' &&
      !Array.isArray(verificationEvent.metadata)
        ? verificationEvent.metadata
        : {};

    return metadata[VERIFICATION_THREAD_TYPE_METADATA_KEY] === REPORT_REVIEW_THREAD_TYPE;
  }

  private async createCaseThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    useReportReviewThread: boolean,
    sourceMessage?: Message
  ): Promise<void> {
    const thread = useReportReviewThread
      ? await this.threadManager.createReportReviewThread(
          member,
          verificationEvent,
          detectionResult,
          sourceMessage
        )
      : await this.threadManager.createVerificationThread(member, verificationEvent);

    if (!thread) {
      const threadKind = useReportReviewThread ? 'report review thread' : 'verification thread';
      throw new Error(`Failed to create ${threadKind} for ${member.user.tag}`);
    }
  }

  private formatActionFailureMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || 'Unknown error');
  }

  private async recordVerificationActionFailure(
    verificationEvent: VerificationEvent,
    action: string,
    error: unknown
  ): Promise<VerificationEvent> {
    const updatedMetadata = appendVerificationActionFailure(verificationEvent.metadata, {
      action,
      message: this.formatActionFailureMessage(error),
      at: new Date().toISOString(),
    });

    const updatedEvent = await this.verificationEventRepository.update(verificationEvent.id, {
      metadata: updatedMetadata as VerificationEvent['metadata'],
    });

    return (
      updatedEvent ?? {
        ...verificationEvent,
        metadata: updatedMetadata as VerificationEvent['metadata'],
      }
    );
  }

  private async tryRestrictUser(
    member: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<VerificationEvent> {
    try {
      const restricted = await this.userModerationService.restrictUser(member);
      if (!restricted) {
        throw new Error(`Failed to restrict user ${member.user.tag}`);
      }
      return verificationEvent;
    } catch (error) {
      console.error(`Failed to restrict user ${member.user.tag}; continuing case flow:`, error);
      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        is_restricted: false,
        verification_status: VerificationStatus.PENDING,
        last_status_change: new Date(),
      });
      return this.recordVerificationActionFailure(verificationEvent, 'restrict', error);
    }
  }

  private async tryCreateCaseThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    useReportReviewThread: boolean,
    sourceMessage?: Message
  ): Promise<VerificationEvent> {
    try {
      await this.createCaseThread(
        member,
        verificationEvent,
        detectionResult,
        useReportReviewThread,
        sourceMessage
      );
      return verificationEvent;
    } catch (error) {
      console.error(
        `Failed to create case thread for ${member.user.tag}; continuing notification:`,
        error
      );
      return this.recordVerificationActionFailure(verificationEvent, 'thread', error);
    }
  }

  private async upsertReportObservedAlertOrActiveCase(
    member: GuildMember,
    detectionResult: DetectionResult,
    detectionEventId: string
  ): Promise<void> {
    const activeVerificationEvent =
      await this.verificationEventRepository.findActiveByUserAndServer(member.id, member.guild.id);

    if (!activeVerificationEvent) {
      const notificationMessage =
        await this.notificationManager.upsertObservedDetectionNotification(member, detectionResult);
      if (!notificationMessage) {
        throw new Error('Failed to send or update report observed alert');
      }
      return;
    }

    const linkedDetectionEvent = await this.detectionEventsRepository.linkToVerificationEvent(
      detectionEventId,
      activeVerificationEvent.id
    );
    if (!linkedDetectionEvent) {
      throw new Error(
        `Failed to link report detection event ${detectionEventId} to verification event ${activeVerificationEvent.id}`
      );
    }

    await this.upsertNotification(member, detectionResult, activeVerificationEvent);
  }

  private async getObservedDetectionForMember(
    member: GuildMember,
    detectionEventId: string
  ): Promise<DetectionEvent> {
    return this.getObservedDetectionForUser(member.guild.id, member.id, detectionEventId);
  }

  private async getObservedDetectionForUser(
    guildId: string,
    userId: string,
    detectionEventId: string
  ): Promise<DetectionEvent> {
    const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
    if (!detectionEvent) {
      throw new Error(`Detection event ${detectionEventId} not found`);
    }
    if (detectionEvent.server_id !== guildId || detectionEvent.user_id !== userId) {
      throw new Error(`Detection event ${detectionEventId} does not match selected member`);
    }
    return detectionEvent;
  }

  private async ensureObservedCase(
    member: GuildMember,
    detectionEvent: DetectionEvent,
    useReportReviewThread?: boolean
  ): Promise<VerificationEvent> {
    const detectionResult = this.createDetectionResultFromEvent(detectionEvent);
    const shouldUseReviewThread =
      useReportReviewThread ?? this.shouldUseReportReviewThread(false, detectionResult);
    await this.handleSuspiciousMember(
      member,
      detectionResult,
      undefined,
      false,
      shouldUseReviewThread
    );

    const verificationEvent = await this.verificationEventRepository.findActiveByUserAndServer(
      member.id,
      member.guild.id
    );
    if (!verificationEvent) {
      throw new Error(`Failed to create or find pending case for ${member.user.tag}`);
    }

    if (
      !verificationEvent.thread_id ||
      (!shouldUseReviewThread && this.hasReportReviewThread(verificationEvent))
    ) {
      await this.createCaseThread(
        member,
        verificationEvent,
        detectionResult,
        shouldUseReviewThread
      );
      await this.upsertNotification(member, detectionResult, verificationEvent);
    }

    return verificationEvent;
  }

  private async updateDetectionMetadataForObservedAction(
    detectionEvent: DetectionEvent,
    moderator: User,
    actionType: AdminActionType
  ): Promise<DetectionEvent | null> {
    return this.detectionEventsRepository.claimObservedAction(detectionEvent.id, {
      observed_action: actionType,
      observed_action_by: moderator.id,
      observed_action_at: new Date().toISOString(),
    });
  }

  private async releaseDetectionMetadataForObservedAction(
    detectionEvent: DetectionEvent,
    moderator: User,
    actionType: AdminActionType
  ): Promise<void> {
    await this.detectionEventsRepository.releaseObservedAction(
      detectionEvent.id,
      actionType,
      moderator.id
    );
  }

  private async restoreDetectionMetadataForObservedAction(
    detectionEvent: DetectionEvent,
    moderator: User,
    actionType: AdminActionType
  ): Promise<void> {
    const metadata =
      detectionEvent.metadata &&
      typeof detectionEvent.metadata === 'object' &&
      !Array.isArray(detectionEvent.metadata)
        ? detectionEvent.metadata
        : {};

    await this.detectionEventsRepository.claimObservedAction(detectionEvent.id, {
      observed_action: actionType,
      observed_action_by:
        typeof metadata.observed_action_by === 'string'
          ? metadata.observed_action_by
          : moderator.id,
      observed_action_at:
        typeof metadata.observed_action_at === 'string'
          ? metadata.observed_action_at
          : new Date().toISOString(),
    });
  }

  private hasObservedAction(detectionEvent: DetectionEvent): boolean {
    return this.getObservedAction(detectionEvent) !== null;
  }

  private getObservedAction(detectionEvent: DetectionEvent): AdminActionType | null {
    const metadata = detectionEvent.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }
    const observedAction = metadata.observed_action;
    return typeof observedAction === 'string' &&
      Object.values(AdminActionType).includes(observedAction as AdminActionType)
      ? (observedAction as AdminActionType)
      : null;
  }

  private async recordObservedAction(data: {
    serverId: string;
    userId: string;
    moderator: User;
    detectionEvent: DetectionEvent;
    verificationEvent?: VerificationEvent;
    actionType: AdminActionType;
    notes?: string | null;
  }): Promise<void> {
    await this.adminActionService.recordAction({
      server_id: data.serverId,
      user_id: data.userId,
      admin_id: data.moderator.id,
      verification_event_id: data.verificationEvent?.id ?? null,
      detection_event_id: data.detectionEvent.id,
      action_type: data.actionType,
      previous_status: data.verificationEvent?.status ?? null,
      new_status: data.verificationEvent?.status ?? null,
      notes: data.notes ?? null,
    });
  }

  private async hasRecordedObservedAction(
    serverId: string,
    userId: string,
    detectionEventId: string,
    actionType: AdminActionType
  ): Promise<boolean> {
    const actions = await this.adminActionService.getActionsForUser(serverId, userId);
    return actions.some(
      (action) =>
        action.detection_event_id === detectionEventId && action.action_type === actionType
    );
  }

  private async ensureObservedEntitiesExist(guildId: string, userId: string): Promise<void> {
    await this.serverRepository.getOrCreateServer(guildId);
    await this.userRepository.getOrCreateUser(userId);
    await this.serverMemberRepository.upsertMember(guildId, userId, {});
  }

  private async handleSuspiciousMember(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message,
    restrictUser = true,
    useReportReviewThread?: boolean
  ): Promise<boolean> {
    const shouldUseReviewThread =
      useReportReviewThread ?? this.shouldUseReportReviewThread(restrictUser, detectionResult);

    // Create durable case state before Discord side effects so moderators see partial failures.
    await this.ensureEntitiesExist(
      member.guild.id,
      member.id,
      member.user.username,
      member.joinedAt?.toISOString()
    );

    const detectionEventId = await this.ensureDetectionEventId(
      member,
      detectionResult,
      sourceMessage
    );

    const activeVerificationEvent =
      await this.verificationEventRepository.findActiveByUserAndServer(member.id, member.guild.id);

    if (activeVerificationEvent) {
      let notificationVerificationEvent = activeVerificationEvent;
      console.log(
        `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Updating notification.`
      );
      const linkedDetectionEvent = await this.detectionEventsRepository.linkToVerificationEvent(
        detectionEventId,
        activeVerificationEvent.id
      );
      if (!linkedDetectionEvent) {
        throw new Error(
          `Failed to link detection event ${detectionEventId} to verification event ${activeVerificationEvent.id}`
        );
      }
      if (restrictUser) {
        const initialDetection = activeVerificationEvent.detection_event_id
          ? await this.detectionEventsRepository.findById(
              activeVerificationEvent.detection_event_id
            )
          : null;
        if (initialDetection?.detection_type === DetectionType.USER_REPORT) {
          const serverMember = await this.serverMemberRepository.findByServerAndUser(
            member.guild.id,
            member.id
          );
          if (serverMember?.is_restricted !== true) {
            notificationVerificationEvent = await this.tryRestrictUser(
              member,
              activeVerificationEvent
            );
          }
        }
      }
      await this.upsertNotification(
        member,
        detectionResult,
        notificationVerificationEvent,
        sourceMessage
      );
      return true;
    }

    console.log(
      `No active verification found for user ${member.user.tag}. Creating new verification event.`
    );

    let newVerificationEvent = await this.verificationEventRepository.createFromDetection(
      detectionEventId,
      member.guild.id,
      member.id,
      VerificationStatus.PENDING
    );

    const linkedDetectionEvent = await this.detectionEventsRepository.linkToVerificationEvent(
      detectionEventId,
      newVerificationEvent.id
    );
    if (!linkedDetectionEvent) {
      throw new Error(
        `Failed to link detection event ${detectionEventId} to verification event ${newVerificationEvent.id}`
      );
    }

    if (restrictUser) {
      newVerificationEvent = await this.tryRestrictUser(member, newVerificationEvent);
    } else {
      await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
        is_restricted: false,
        verification_status: VerificationStatus.PENDING,
        last_status_change: new Date(),
      });
    }

    newVerificationEvent = await this.tryCreateCaseThread(
      member,
      newVerificationEvent,
      detectionResult,
      shouldUseReviewThread,
      sourceMessage
    );

    await this.upsertNotification(member, detectionResult, newVerificationEvent, sourceMessage);

    return true;
  }

  /**
   * Handle the response to a suspicious message
   *
   * @param member The guild member who sent the message
   * @param detectionResult The detection result from the orchestrator
   * @param sourceMessage The original message that triggered the detection
   * @returns Whether the action was successfully executed
   */
  public async handleSuspiciousMessage(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<boolean> {
    try {
      console.log(`Suspicious message detected for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      return await this.handleSuspiciousMember(member, detectionResult, sourceMessage);
    } catch (error) {
      console.error(`Failed to handle suspicious message for ${member.user.tag}:`, error);
      throw error;
    }
  }

  /**
   * Handle the response to a suspicious new join
   *
   * @param member The guild member who joined
   * @param detectionResult The detection result from the orchestrator
   * @returns Whether the action was successfully executed
   */
  public async handleSuspiciousJoin(
    member: GuildMember,
    detectionResult: DetectionResult
  ): Promise<boolean> {
    try {
      console.log(`Suspicious join detected for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      return await this.handleSuspiciousMember(member, detectionResult);
    } catch (error) {
      console.error(`Failed to handle suspicious join for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async openCaseForSuspiciousMessage(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<boolean> {
    try {
      console.log(`Opening case without restriction for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      return await this.handleSuspiciousMember(member, detectionResult, sourceMessage, false);
    } catch (error) {
      console.error(`Failed to open case without restriction for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async openCaseForSuspiciousJoin(
    member: GuildMember,
    detectionResult: DetectionResult
  ): Promise<boolean> {
    try {
      console.log(`Opening join case without restriction for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      return await this.handleSuspiciousMember(member, detectionResult, undefined, false);
    } catch (error) {
      console.error(`Failed to open join case without restriction for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async handleManualFlag(
    member: GuildMember,
    moderator: User,
    reason?: string
  ): Promise<boolean> {
    try {
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      const reasonText = reason ? `Reason: ${reason}` : 'No reason provided.';
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: member.guild.id,
        user_id: member.id,
        detection_type: DetectionType.GPT_ANALYSIS,
        confidence: 1.0,
        reasons: [`Manually flagged by admin ${moderator.id}. ${reasonText}`],
        detected_at: new Date(),
        metadata: { type: 'admin_flag', adminId: moderator.id, reason: reason ?? reasonText },
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [`Manually flagged by admin ${moderator.id}. ${reasonText}`],
        triggerSource: DetectionType.GPT_ANALYSIS,
        triggerContent: reason ?? 'Manual admin flag',
        detectionEventId: detectionEvent.id,
      };

      return await this.handleSuspiciousMember(member, detectionResult);
    } catch (error) {
      console.error(`Failed to handle manual flag for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async handleUserReport(
    member: GuildMember,
    reporter: User,
    reason?: string
  ): Promise<boolean> {
    try {
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      const reasonText = reason ? `Reason: ${reason}` : 'No reason provided.';
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: member.guild.id,
        user_id: member.id,
        detection_type: DetectionType.USER_REPORT,
        confidence: 1.0,
        reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
        detected_at: new Date(),
        metadata: {
          type: 'user_report',
          reporterId: reporter.id,
          content: reason ?? 'User report',
          reason: reason ?? reasonText,
        },
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason ?? 'User report',
        detectionEventId: detectionEvent.id,
      };

      await this.upsertReportObservedAlertOrActiveCase(member, detectionResult, detectionEvent.id);
      return true;
    } catch (error) {
      console.error(`Failed to handle user report for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async handleMessageReport(
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext
  ): Promise<boolean> {
    try {
      await this.userRepository.getOrCreateUser(targetUser.id, targetUser.username);

      const reasonText = report.reason ? `Reason: ${report.reason}` : 'No reason provided.';
      const reason = `Message reported by user ${reporter.id}. ${reasonText}`;
      const isGuildContext =
        report.interactionContext === InteractionContextType.Guild || !!report.guildId;
      const metadata: Record<string, unknown> = {
        type: isGuildContext ? 'guild_message_report' : 'user_installed_message_report',
        reporterId: reporter.id,
        targetUserId: targetUser.id,
        targetUsername: targetUser.username,
        messageId: report.messageId,
      };
      if (report.guildId) metadata.guildId = report.guildId;
      if (report.channelId) metadata.channelId = report.channelId;
      if (report.content) metadata.content = report.content;
      if (report.reason) metadata.reason = report.reason;
      if (report.interactionContext !== undefined) {
        metadata.interactionContext = report.interactionContext;
      }

      const globalReport = await this.detectionEventsRepository.create({
        server_id: null,
        user_id: targetUser.id,
        detection_type: DetectionType.USER_REPORT,
        confidence: 1.0,
        reasons: [reason],
        message_id: report.messageId,
        channel_id: report.channelId,
        metadata,
      });

      await this.processMessageReportForManagedServers(
        targetUser,
        reporter,
        report,
        globalReport.id
      );

      return true;
    } catch (error) {
      console.error(`Failed to handle message report for ${targetUser.id}:`, error);
      throw error;
    }
  }

  private async processMessageReportForManagedServers(
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext,
    globalReportId: string
  ): Promise<void> {
    const handledServerIds = new Set<string>();

    if (report.guildId) {
      const localServer = await this.serverRepository.findByGuildId(report.guildId);
      if (localServer?.is_active) {
        handledServerIds.add(report.guildId);
        await this.processMessageReportForManagedServer(
          report.guildId,
          targetUser,
          reporter,
          report,
          globalReportId,
          true
        );
      }
    }

    const memberships = await this.serverMemberRepository.findByUser(targetUser.id);

    for (const membership of memberships) {
      const serverId = membership.server_id;
      if (handledServerIds.has(serverId)) {
        continue;
      }
      handledServerIds.add(serverId);

      const server = await this.serverRepository.findByGuildId(serverId);
      if (!server?.is_active) {
        continue;
      }

      const isLocalReport = report.guildId === serverId;
      const reportSettings = getUserReportSettings(server.settings);
      const responseMode = isLocalReport ? 'open_case' : reportSettings.externalResponseMode;
      if (responseMode === 'off') {
        continue;
      }
      // notify_only and open_case both use observed alerts now. The distinction is
      // retained for compatibility and future UX polish.

      await this.processMessageReportForManagedServer(
        serverId,
        targetUser,
        reporter,
        report,
        globalReportId,
        isLocalReport
      );
    }
  }

  private async processMessageReportForManagedServer(
    serverId: string,
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext,
    globalReportId: string,
    isLocalReport: boolean
  ): Promise<void> {
    const member = await this.fetchManagedReportMember(serverId, targetUser.id);
    if (!member) {
      return;
    }

    const serverDetectionEvent = await this.createManagedMessageReportDetection(
      member,
      reporter,
      report,
      globalReportId,
      isLocalReport
    );
    const reasonText = report.reason ? ` Reason: ${report.reason}` : '';
    const detectionResult: DetectionResult = {
      label: 'SUSPICIOUS',
      confidence: 1.0,
      reasons: [
        isLocalReport
          ? `Message reported in this server by user ${reporter.id}.${reasonText}`
          : `External DM/GDM report submitted by user ${reporter.id}.${reasonText}`,
      ],
      triggerSource: DetectionType.USER_REPORT,
      triggerContent: report.reason || report.content || 'Message report',
      detectionEventId: serverDetectionEvent.id,
    };

    try {
      await this.upsertReportObservedAlertOrActiveCase(
        member,
        detectionResult,
        serverDetectionEvent.id
      );
    } catch (error) {
      console.error(`Failed to process message report fan-out for guild ${serverId}:`, error);
    }
  }

  private async fetchManagedReportMember(
    guildId: string,
    userId: string
  ): Promise<GuildMember | null> {
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    return (await guild?.members.fetch(userId).catch(() => null)) ?? null;
  }

  private async createManagedMessageReportDetection(
    member: GuildMember,
    reporter: User | APIUser,
    report: MessageReportContext,
    globalReportId: string,
    isLocalReport: boolean
  ): Promise<DetectionEvent> {
    const metadata: Record<string, unknown> = {
      type: isLocalReport ? 'message_report' : 'external_message_report',
      globalReportId,
      reporterId: reporter.id,
      targetUserId: member.id,
      messageId: report.messageId,
    };
    if (report.guildId) metadata.sourceGuildId = report.guildId;
    if (report.channelId) metadata.sourceChannelId = report.channelId;
    if (report.content) metadata.content = report.content;
    if (report.reason) metadata.reason = report.reason;
    if (report.interactionContext !== undefined) {
      metadata.interactionContext = report.interactionContext;
    }

    return await this.detectionEventsRepository.create({
      server_id: member.guild.id,
      user_id: member.id,
      detection_type: DetectionType.USER_REPORT,
      confidence: 1.0,
      reasons: [
        isLocalReport
          ? `Message reported in this server by user ${reporter.id}.${report.reason ? ` Reason: ${report.reason}` : ''}`
          : `External DM/GDM report submitted by user ${reporter.id}.${report.reason ? ` Reason: ${report.reason}` : ''}`,
      ],
      message_id: isLocalReport ? report.messageId : undefined,
      channel_id: isLocalReport ? report.channelId : undefined,
      metadata,
    });
  }

  public async openObservedDetectionCase(
    member: GuildMember,
    detectionEventId: string,
    moderator: User
  ): Promise<boolean> {
    const detectionEvent = await this.getObservedDetectionForMember(member, detectionEventId);
    if (this.hasObservedAction(detectionEvent)) {
      return false;
    }
    const claimedDetectionEvent = await this.updateDetectionMetadataForObservedAction(
      detectionEvent,
      moderator,
      AdminActionType.OPEN_CASE
    );
    if (!claimedDetectionEvent) {
      return false;
    }
    let actionRecorded = false;
    try {
      const verificationEvent = await this.ensureObservedCase(member, detectionEvent);
      await this.recordObservedAction({
        serverId: member.guild.id,
        userId: member.id,
        moderator,
        detectionEvent: claimedDetectionEvent,
        verificationEvent,
        actionType: AdminActionType.OPEN_CASE,
      });
      actionRecorded = true;
      await this.notificationManager.markObservedDetectionActionTaken(
        detectionEvent.id,
        'opened a verification case',
        moderator
      );
      return true;
    } catch (error) {
      if (!actionRecorded) {
        await this.releaseDetectionMetadataForObservedAction(
          detectionEvent,
          moderator,
          AdminActionType.OPEN_CASE
        );
      }
      throw error;
    }
  }

  public async restrictObservedDetection(
    member: GuildMember,
    detectionEventId: string,
    moderator: User
  ): Promise<boolean> {
    const detectionEvent = await this.getObservedDetectionForMember(member, detectionEventId);
    if (this.hasObservedAction(detectionEvent)) {
      return false;
    }
    const claimedDetectionEvent = await this.updateDetectionMetadataForObservedAction(
      detectionEvent,
      moderator,
      AdminActionType.RESTRICT
    );
    if (!claimedDetectionEvent) {
      return false;
    }
    let actionApplied = false;
    try {
      const verificationEvent = await this.ensureObservedCase(member, detectionEvent, false);
      await this.userModerationService.restrictUser(member);
      actionApplied = true;
      await this.recordObservedAction({
        serverId: member.guild.id,
        userId: member.id,
        moderator,
        detectionEvent: claimedDetectionEvent,
        verificationEvent,
        actionType: AdminActionType.RESTRICT,
      });
      await this.notificationManager.markObservedDetectionActionTaken(
        detectionEvent.id,
        'restricted this user',
        moderator
      );
      return true;
    } catch (error) {
      if (!actionApplied) {
        await this.releaseDetectionMetadataForObservedAction(
          detectionEvent,
          moderator,
          AdminActionType.RESTRICT
        );
      }
      throw error;
    }
  }

  public async banObservedDetection(
    member: GuildMember,
    detectionEventId: string,
    moderator: User,
    reason: string
  ): Promise<boolean> {
    const detectionEvent = await this.getObservedDetectionForMember(member, detectionEventId);
    if (this.hasObservedAction(detectionEvent)) {
      return false;
    }
    const claimedDetectionEvent = await this.updateDetectionMetadataForObservedAction(
      detectionEvent,
      moderator,
      AdminActionType.BAN
    );
    if (!claimedDetectionEvent) {
      return false;
    }
    let actionApplied = false;
    try {
      await this.ensureObservedEntitiesExist(member.guild.id, member.id);
      const activeVerificationEvent =
        await this.verificationEventRepository.findActiveByUserAndServer(
          member.id,
          member.guild.id
        );
      await this.userModerationService.banUser(member, reason, moderator, detectionEvent.id);
      actionApplied = true;
      const actionAlreadyRecorded = await this.hasRecordedObservedAction(
        member.guild.id,
        member.id,
        claimedDetectionEvent.id,
        AdminActionType.BAN
      );
      if (!actionAlreadyRecorded) {
        const currentVerificationEvent = activeVerificationEvent
          ? await this.verificationEventRepository.findById(activeVerificationEvent.id)
          : null;
        await this.recordObservedAction({
          serverId: member.guild.id,
          userId: member.id,
          moderator,
          detectionEvent: claimedDetectionEvent,
          verificationEvent: currentVerificationEvent ?? activeVerificationEvent ?? undefined,
          actionType: AdminActionType.BAN,
          notes: reason,
        });
      }
      await this.notificationManager.markObservedDetectionActionTaken(
        detectionEvent.id,
        'banned this user',
        moderator
      );
      return true;
    } catch (error) {
      if (!actionApplied) {
        await this.releaseDetectionMetadataForObservedAction(
          detectionEvent,
          moderator,
          AdminActionType.BAN
        );
      }
      throw error;
    }
  }

  public async dismissObservedDetection(
    guildId: string,
    userId: string,
    detectionEventId: string,
    moderator: User,
    actionType: AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE
  ): Promise<boolean> {
    const detectionEvent = await this.getObservedDetectionForUser(
      guildId,
      userId,
      detectionEventId
    );
    if (this.hasObservedAction(detectionEvent)) {
      return false;
    }
    const claimedDetectionEvent = await this.updateDetectionMetadataForObservedAction(
      detectionEvent,
      moderator,
      actionType
    );
    if (!claimedDetectionEvent) {
      return false;
    }
    let actionRecorded = false;
    try {
      await this.ensureObservedEntitiesExist(guildId, userId);
      await this.recordObservedAction({
        serverId: guildId,
        userId,
        moderator,
        detectionEvent: claimedDetectionEvent,
        actionType,
      });
      actionRecorded = true;
      await this.notificationManager.markObservedDetectionActionTaken(
        detectionEvent.id,
        actionType === AdminActionType.FALSE_POSITIVE
          ? 'marked this detection as a false positive'
          : 'dismissed this alert',
        moderator,
        {
          undoButtonLabel:
            actionType === AdminActionType.FALSE_POSITIVE
              ? 'Undo False Positive'
              : 'Undo Dismissal',
        }
      );
      return true;
    } catch (error) {
      if (!actionRecorded) {
        await this.releaseDetectionMetadataForObservedAction(detectionEvent, moderator, actionType);
      }
      throw error;
    }
  }

  public async undoObservedDetectionAction(
    guildId: string,
    userId: string,
    detectionEventId: string,
    moderator: User
  ): Promise<AdminActionType.DISMISS | AdminActionType.FALSE_POSITIVE | null> {
    const detectionEvent = await this.getObservedDetectionForUser(
      guildId,
      userId,
      detectionEventId
    );
    const observedAction = this.getObservedAction(detectionEvent);
    if (
      observedAction !== AdminActionType.DISMISS &&
      observedAction !== AdminActionType.FALSE_POSITIVE
    ) {
      return null;
    }

    await this.ensureObservedEntitiesExist(guildId, userId);
    const restoredDetectionEvent = await this.detectionEventsRepository.clearObservedAction(
      detectionEvent.id,
      [AdminActionType.DISMISS, AdminActionType.FALSE_POSITIVE]
    );
    if (!restoredDetectionEvent) {
      return null;
    }

    let actionRecorded = false;
    try {
      await this.recordObservedAction({
        serverId: guildId,
        userId,
        moderator,
        detectionEvent: restoredDetectionEvent,
        actionType: AdminActionType.UNDO_OBSERVED_ACTION,
        notes:
          observedAction === AdminActionType.FALSE_POSITIVE
            ? 'Undid dismissal and reverted false positive indication.'
            : 'Undid dismissal.',
      });
      actionRecorded = true;
      await this.notificationManager.restoreObservedDetectionActions(
        detectionEvent.id,
        observedAction === AdminActionType.FALSE_POSITIVE
          ? 'undid the dismissal and reverted the false positive indication'
          : 'undid the dismissal',
        moderator
      );
      return observedAction;
    } catch (error) {
      if (!actionRecorded) {
        await this.restoreDetectionMetadataForObservedAction(
          detectionEvent,
          moderator,
          observedAction
        );
      }
      throw error;
    }
  }

  // TODO: Refactor reopenVerification to use events
  /**
   * Reopens a verification event, and re-restricts the user (or unbans them?)
   * @param verificationEvent The verification event to reopen
   * @param moderator The moderator who is reopening the verification event
   * @returns Whether the action was successfully executed
   */
  public async reopenVerification(
    verificationEvent: VerificationEvent,
    moderator: User
  ): Promise<boolean> {
    try {
      const previousStatus = verificationEvent.status;

      const updatedEvent = await this.verificationEventRepository.update(verificationEvent.id, {
        status: VerificationStatus.PENDING,
        resolved_at: null,
        resolved_by: null,
      });

      if (!updatedEvent) {
        throw new Error(`Verification event ${verificationEvent.id} not found for reopen.`);
      }

      const guild = await this.client.guilds.fetch(verificationEvent.server_id);
      const member = await guild.members.fetch(verificationEvent.user_id);

      await this.ensureEntitiesExist(
        verificationEvent.server_id,
        verificationEvent.user_id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      await this.threadManager.reopenVerificationThread(verificationEvent);
      await this.userModerationService.restrictUser(member);
      await this.notificationManager.logActionToMessage(
        verificationEvent,
        AdminActionType.REOPEN,
        moderator
      );
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        VerificationStatus.PENDING
      );

      await this.adminActionService.recordAction({
        server_id: verificationEvent.server_id,
        user_id: verificationEvent.user_id,
        admin_id: moderator.id,
        verification_event_id: verificationEvent.id,
        action_type: AdminActionType.REOPEN,
        previous_status: previousStatus,
        new_status: VerificationStatus.PENDING,
        notes: null,
      });

      return true;
    } catch (error) {
      console.error(
        `Failed to reopen verification event ${verificationEvent.id} for user ${verificationEvent.user_id}:`,
        error
      );
      throw error;
    }
  }
}
