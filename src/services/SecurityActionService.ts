import { injectable, inject, optional } from 'inversify';
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
import type { IGPTService, ReportAIAnalysis } from './GPTService';
import {
  getReportAiSettings,
  ReportAttachmentMetadata,
  selectEligibleReportImageAttachments,
} from '../utils/reportAiSettings';
import {
  appendVerificationActionFailure,
  type VerificationActionFailureKind,
} from '../utils/verificationActionFailures';
import { createAccountingExclusionMetadata } from '../utils/detectionEventAccounting';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
  ProductAnalyticsIdentifiers,
  ProductAnalyticsProperties,
} from './ProductAnalyticsService';
import { getConfidenceBucket } from '../utils/analyticsHelpers';
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

  excludeDetectionFromAccounting(
    guildId: string,
    detectionEventId: string,
    moderator: User,
    reason?: string
  ): Promise<DetectionEvent | null>;

  restoreDetectionAccounting(
    guildId: string,
    detectionEventId: string,
    moderator: User,
    reason?: string
  ): Promise<DetectionEvent | null>;

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
  attachments?: MessageReportAttachment[];
  interactionContext?: InteractionContextType;
}

export type MessageReportAttachment = ReportAttachmentMetadata;

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
  private gptService?: IGPTService;
  private productAnalyticsService: IProductAnalyticsService;

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
    @inject(TYPES.DiscordClient) client: Client,
    @optional() @inject(TYPES.GPTService) gptService?: IGPTService,
    @inject(TYPES.ProductAnalyticsService)
    @optional()
    productAnalyticsService?: IProductAnalyticsService
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
    this.gptService = gptService;
    this.productAnalyticsService = productAnalyticsService ?? NOOP_PRODUCT_ANALYTICS_SERVICE;
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
      reportAiAnalysis: this.getReportAiAnalysisFromMetadata(metadata),
    };
  }

  private getReportAiAnalysisFromMetadata(
    metadata: Record<string, unknown>
  ): ReportAIAnalysis | undefined {
    const reportAi = metadata.report_ai;
    return reportAi && typeof reportAi === 'object' && !Array.isArray(reportAi)
      ? (reportAi as ReportAIAnalysis)
      : undefined;
  }

  private capReportAiAction(
    analysis: ReportAIAnalysis,
    settings: ReturnType<typeof getReportAiSettings>
  ): ReportAIAnalysis {
    const recommendedAction = this.capReportAiRecommendedAction(
      analysis.recommendedAction,
      analysis.confidence,
      settings
    );

    return recommendedAction === analysis.recommendedAction
      ? analysis
      : { ...analysis, recommendedAction };
  }

  private capReportAiRecommendedAction(
    action: ReportAIAnalysis['recommendedAction'],
    confidence: number,
    settings: ReturnType<typeof getReportAiSettings>
  ): ReportAIAnalysis['recommendedAction'] {
    if (action === 'none' || action === 'monitor' || action === 'manual_review') {
      return action;
    }

    if (settings.maxAction === 'hints' || settings.maxAction === 'off') {
      return 'manual_review';
    }

    if (action === 'restrict') {
      if (settings.maxAction === 'restrict' && confidence >= settings.restrictThreshold) {
        return 'restrict';
      }

      return confidence >= settings.openCaseThreshold ? 'open_case' : 'manual_review';
    }

    return confidence >= settings.openCaseThreshold ? 'open_case' : 'manual_review';
  }

  private async analyzeReportIfEnabled(data: {
    serverId: string;
    targetUserId: string;
    reporterId: string;
    reason?: string;
    reportedMessageContent?: string;
    attachments?: MessageReportAttachment[];
  }): Promise<ReportAIAnalysis | undefined> {
    const server = await this.serverRepository.findByGuildId(data.serverId);
    const settings = getReportAiSettings(server?.settings);
    if (!settings.enabled || settings.maxAction === 'off') {
      return undefined;
    }
    if (!this.gptService) {
      return undefined;
    }

    const eligibleImages = selectEligibleReportImageAttachments(data.attachments, settings);
    const reportReason = settings.analyzeText ? data.reason : undefined;
    const reportedMessageContent = settings.analyzeText ? data.reportedMessageContent : undefined;
    if (!reportReason && !reportedMessageContent && eligibleImages.length === 0) {
      return undefined;
    }

    const analysis = await this.gptService.analyzeReportEvidence({
      serverId: data.serverId,
      targetUserId: data.targetUserId,
      reporterId: data.reporterId,
      reportReason,
      reportedMessageContent,
      attachments: eligibleImages,
    });

    return this.capReportAiAction(analysis, settings);
  }

  private serializeReportAttachments(
    attachments: MessageReportAttachment[] | undefined
  ): MessageReportAttachment[] | undefined {
    if (!attachments?.length) {
      return undefined;
    }

    return attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      proxyUrl: attachment.proxyUrl,
      contentType: attachment.contentType,
      size: attachment.size,
    }));
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
    action: VerificationActionFailureKind,
    error: unknown
  ): Promise<VerificationEvent> {
    const updatedMetadata = appendVerificationActionFailure(verificationEvent.metadata, {
      action,
      message: this.formatActionFailureMessage(error),
      at: new Date().toISOString(),
    });

    const fallbackEvent = {
      ...verificationEvent,
      metadata: updatedMetadata as VerificationEvent['metadata'],
    };

    try {
      const updatedEvent = await this.verificationEventRepository.update(verificationEvent.id, {
        metadata: updatedMetadata as VerificationEvent['metadata'],
      });

      return updatedEvent ?? fallbackEvent;
    } catch (recordError) {
      console.error(
        `Failed to record ${action} failure for verification event ${verificationEvent.id}; continuing notification:`,
        recordError
      );
      return fallbackEvent;
    }
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

  private async getAuditDetectionForModerator(
    guildId: string,
    detectionEventId: string,
    moderatorId: string
  ): Promise<DetectionEvent | null> {
    const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
    if (!detectionEvent?.user_id) {
      return null;
    }

    return detectionEvent.server_id === guildId || this.isGlobalAuditAdmin(moderatorId)
      ? detectionEvent
      : null;
  }

  private isGlobalAuditAdmin(userId: string): boolean {
    return (process.env.DRASIL_GLOBAL_ADMIN_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0)
      .includes(userId);
  }

  private async ensureAuditEntitiesExist(detectionEvent: DetectionEvent): Promise<void> {
    await this.userRepository.getOrCreateUser(detectionEvent.user_id);
    if (detectionEvent.server_id) {
      await this.ensureObservedEntitiesExist(detectionEvent.server_id, detectionEvent.user_id);
    }
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
    const metadata: Record<string, unknown> = {
      observed_action: actionType,
      observed_action_by: moderator.id,
      observed_action_at: new Date().toISOString(),
    };

    if (actionType === AdminActionType.FALSE_POSITIVE) {
      Object.assign(
        metadata,
        createAccountingExclusionMetadata(moderator.id, 'Marked false positive')
      );
    }

    return this.detectionEventsRepository.claimObservedAction(detectionEvent.id, metadata);
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
    serverId: string | null;
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

  private captureMemberAnalytics(
    member: GuildMember,
    event: string,
    properties: ProductAnalyticsProperties = {},
    identifiers: ProductAnalyticsIdentifiers = {}
  ): void {
    void this.productAnalyticsService.captureUserEvent(
      member.guild.id,
      member.id,
      event,
      properties,
      identifiers
    );
  }

  private captureDetectionCaseAnalytics(
    member: GuildMember,
    event: string,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    properties: ProductAnalyticsProperties = {}
  ): void {
    this.captureMemberAnalytics(
      member,
      event,
      {
        detection_type: detectionResult.triggerSource,
        confidence: detectionResult.confidence,
        confidence_bucket: getConfidenceBucket(detectionResult.confidence),
        restrict_user: properties.restrict_user,
        report_review_thread: properties.report_review_thread,
        active_case_existed: properties.active_case_existed,
      },
      {
        detectionEventId: detectionResult.detectionEventId,
        verificationEventId: verificationEvent.id,
      }
    );
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
      this.captureDetectionCaseAnalytics(
        member,
        'verification case updated',
        detectionResult,
        notificationVerificationEvent,
        {
          restrict_user: restrictUser,
          report_review_thread: shouldUseReviewThread,
          active_case_existed: true,
        }
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
    this.captureDetectionCaseAnalytics(
      member,
      'verification case opened',
      detectionResult,
      newVerificationEvent,
      {
        restrict_user: restrictUser,
        report_review_thread: shouldUseReviewThread,
        active_case_existed: false,
      }
    );

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

      const handled = await this.handleSuspiciousMember(member, detectionResult);
      if (handled) {
        this.captureMemberAnalytics(
          member,
          'manual flag submitted',
          {
            has_reason: Boolean(reason?.trim()),
          },
          {
            moderatorId: moderator.id,
            detectionEventId: detectionEvent.id,
          }
        );
      }
      return handled;
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
      const reportAiAnalysis = await this.analyzeReportIfEnabled({
        serverId: member.guild.id,
        targetUserId: member.id,
        reporterId: reporter.id,
        reason,
      }).catch((error) => {
        console.warn(
          `Report AI analysis failed for guild ${member.guild.id}; continuing without AI triage:`,
          error
        );
        return undefined;
      });
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
          ...(reportAiAnalysis ? { report_ai: reportAiAnalysis } : {}),
        },
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason ?? 'User report',
        detectionEventId: detectionEvent.id,
        reportAiAnalysis,
      };

      await this.upsertReportObservedAlertOrActiveCase(member, detectionResult, detectionEvent.id);
      this.captureMemberAnalytics(
        member,
        'user report submitted',
        {
          report_type: 'user_report',
          has_reason: Boolean(reason?.trim()),
        },
        {
          reporterId: reporter.id,
          detectionEventId: detectionEvent.id,
        }
      );
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
      const attachments = this.serializeReportAttachments(report.attachments);
      if (attachments) metadata.attachments = attachments;
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
    const eventMetadata =
      serverDetectionEvent.metadata &&
      typeof serverDetectionEvent.metadata === 'object' &&
      !Array.isArray(serverDetectionEvent.metadata)
        ? serverDetectionEvent.metadata
        : {};
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
      reportAiAnalysis: this.getReportAiAnalysisFromMetadata(eventMetadata),
    };

    try {
      await this.upsertReportObservedAlertOrActiveCase(
        member,
        detectionResult,
        serverDetectionEvent.id
      );
      this.captureMemberAnalytics(
        member,
        'user report submitted',
        {
          report_type: isLocalReport ? 'message_report' : 'external_message_report',
          has_reason: Boolean(report.reason?.trim()),
          has_message_content: Boolean(report.content?.trim()),
        },
        {
          reporterId: reporter.id,
          sourceGuildId: report.guildId === member.guild.id ? report.guildId : undefined,
          detectionEventId: serverDetectionEvent.id,
        }
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
    const attachments = this.serializeReportAttachments(report.attachments);
    if (attachments) metadata.attachments = attachments;
    if (report.interactionContext !== undefined) {
      metadata.interactionContext = report.interactionContext;
    }

    const reportAiAnalysis = isLocalReport
      ? await this.analyzeReportIfEnabled({
          serverId: member.guild.id,
          targetUserId: member.id,
          reporterId: reporter.id,
          reason: report.reason,
          reportedMessageContent: report.content,
          attachments,
        }).catch((error) => {
          console.warn(
            `Report AI analysis failed for guild ${member.guild.id}; continuing without AI triage:`,
            error
          );
          return undefined;
        })
      : undefined;
    if (reportAiAnalysis) {
      metadata.report_ai = reportAiAnalysis;
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
      this.captureMemberAnalytics(
        member,
        'observed detection action completed',
        { action_type: AdminActionType.OPEN_CASE },
        {
          moderatorId: moderator.id,
          detectionEventId: detectionEvent.id,
          verificationEventId: verificationEvent.id,
        }
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
      this.captureMemberAnalytics(
        member,
        'observed detection action completed',
        { action_type: AdminActionType.RESTRICT },
        {
          moderatorId: moderator.id,
          detectionEventId: detectionEvent.id,
          verificationEventId: verificationEvent.id,
        }
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
      this.captureMemberAnalytics(
        member,
        'observed detection action completed',
        { action_type: AdminActionType.BAN },
        {
          moderatorId: moderator.id,
          detectionEventId: detectionEvent.id,
        }
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
      void this.productAnalyticsService.captureUserEvent(
        guildId,
        userId,
        'observed detection action completed',
        { action_type: actionType },
        {
          moderatorId: moderator.id,
          detectionEventId: detectionEvent.id,
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
      void this.productAnalyticsService.captureUserEvent(
        guildId,
        userId,
        'observed detection action completed',
        {
          action_type: AdminActionType.UNDO_OBSERVED_ACTION,
          previous_action_type: observedAction,
        },
        {
          moderatorId: moderator.id,
          detectionEventId: detectionEvent.id,
        }
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

  public async excludeDetectionFromAccounting(
    guildId: string,
    detectionEventId: string,
    moderator: User,
    reason?: string
  ): Promise<DetectionEvent | null> {
    const detectionEvent = await this.getAuditDetectionForModerator(
      guildId,
      detectionEventId,
      moderator.id
    );
    if (!detectionEvent) {
      return null;
    }

    const accountingReason = reason?.trim() || 'Marked false positive';
    const accountingScope = detectionEvent.server_id ? 'server' : 'global';
    await this.ensureAuditEntitiesExist(detectionEvent);
    await this.recordObservedAction({
      serverId: detectionEvent.server_id,
      userId: detectionEvent.user_id,
      moderator,
      detectionEvent,
      actionType: AdminActionType.FALSE_POSITIVE,
      notes: accountingReason,
    });

    return this.detectionEventsRepository.markExcludedFromAccounting(
      detectionEvent.id,
      createAccountingExclusionMetadata(moderator.id, accountingReason, accountingScope)
    );
  }

  public async restoreDetectionAccounting(
    guildId: string,
    detectionEventId: string,
    moderator: User,
    reason?: string
  ): Promise<DetectionEvent | null> {
    const detectionEvent = await this.getAuditDetectionForModerator(
      guildId,
      detectionEventId,
      moderator.id
    );
    if (!detectionEvent) {
      return null;
    }

    await this.ensureAuditEntitiesExist(detectionEvent);
    await this.recordObservedAction({
      serverId: detectionEvent.server_id,
      userId: detectionEvent.user_id,
      moderator,
      detectionEvent,
      actionType: AdminActionType.UNDO_OBSERVED_ACTION,
      notes: reason?.trim() || 'Restored detection to future accounting.',
    });

    return this.detectionEventsRepository.clearAccountingExclusion(detectionEvent.id);
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

      void this.productAnalyticsService.captureUserEvent(
        verificationEvent.server_id,
        verificationEvent.user_id,
        'moderation action completed',
        { action_type: AdminActionType.REOPEN },
        {
          moderatorId: moderator.id,
          verificationEventId: verificationEvent.id,
          detectionEventId: verificationEvent.detection_event_id ?? undefined,
        }
      );

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
