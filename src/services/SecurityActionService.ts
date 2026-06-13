import { injectable, inject, optional } from 'inversify';
import {
  GuildMember,
  Message,
  Client,
  User,
  APIUser,
  InteractionContextType,
  Role,
} from 'discord.js';
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
  VerificationThreadRepairResult,
  VERIFICATION_THREAD_TYPE_METADATA_KEY,
} from './ThreadManager';
import { IUserModerationService } from './UserModerationService';
import { IAdminActionService } from './AdminActionService';
import { getUserReportSettings } from '../utils/userReportSettings';
import type { IGPTService, ReportAIAnalysis } from './GPTService';
import { getReportAiSettings, ReportAttachmentMetadata } from '../utils/reportAiSettings';
import { getReportIntakeSettings } from '../utils/reportIntakeSettings';
import {
  appendVerificationActionFailure,
  clearVerificationActionFailures,
  getVerificationActionFailures,
  type VerificationActionFailureKind,
} from '../utils/verificationActionFailures';
import {
  createAccountingExclusionMetadata,
  withDetectionTestingMetadata,
} from '../utils/detectionEventAccounting';
import {
  IProductAnalyticsService,
  NOOP_PRODUCT_ANALYTICS_SERVICE,
  ProductAnalyticsIdentifiers,
  ProductAnalyticsProperties,
} from './ProductAnalyticsService';
import { getConfidenceBucket } from '../utils/analyticsHelpers';
import { ReportAiAnalyzer } from './ReportAiAnalyzer';
import { ReportDetectionBuilder } from './ReportDetectionBuilder';
import { RoleIntakeProcessor } from './RoleIntakeProcessor';

const DELAYED_THREAD_REPAIR_DELAY_MS = 70_000;
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

  openAdminCase(
    member: GuildMember,
    moderator: User,
    options: AdminCaseOptions
  ): Promise<AdminCaseResult>;

  refreshCaseNotification(
    guildId: string,
    user: User,
    verificationEventId?: string
  ): Promise<CaseNotificationRefreshResult>;

  repairActiveCase(member: GuildMember): Promise<ActiveCaseRepairResult>;

  restrictActiveCase(member: GuildMember, moderator: User): Promise<boolean>;

  intakeRoleMembers(options: RoleIntakeOptions): Promise<RoleIntakeResult>;

  /**
   * Handle a user report submitted via modal
   */
  handleUserReport(member: GuildMember, reporter: User, reason?: string): Promise<boolean>;

  handleConfirmedReportIntake(
    member: GuildMember,
    reporter: User,
    report: ConfirmedReportIntakeContext
  ): Promise<boolean>;

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

export interface ConfirmedReportIntakeContext {
  reason?: string;
  intakeId?: string;
  attachments?: MessageReportAttachment[];
}

export type AdminCaseAction = 'open_case' | 'restrict';

export interface AdminCaseOptions {
  reason?: string;
  action: AdminCaseAction;
  metadata?: Record<string, unknown>;
}

export interface AdminCaseResult {
  opened: boolean;
  restrictionAttempted: boolean;
  restricted: boolean;
}

export interface ActiveCaseRepairResult extends VerificationThreadRepairResult {
  repaired: boolean;
  message: string;
  verificationEventId?: string;
}

export interface CaseNotificationRefreshResult {
  refreshed: boolean;
  message: string;
  verificationEventId?: string;
  status?: VerificationStatus;
  notificationMessageId?: string | null;
  notificationChannelId?: string | null;
}

export interface RoleIntakeOptions {
  role: Role;
  moderator: User;
  reason?: string;
  action: AdminCaseAction;
  execute: boolean;
  limit?: number;
  delayMs?: number;
}

export interface RoleIntakeFailure {
  userId: string;
  message: string;
}

export interface RoleIntakeResult {
  batchId: string;
  roleId: string;
  roleName: string;
  action: AdminCaseAction;
  execute: boolean;
  totalMembers: number;
  eligibleMembers: number;
  processed: number;
  opened: number;
  skippedBots: number;
  skippedActiveCases: number;
  skippedOverLimit: number;
  failed: number;
  failures: RoleIntakeFailure[];
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
  private gptService?: IGPTService;
  private productAnalyticsService: IProductAnalyticsService;
  private reportAiAnalyzer: ReportAiAnalyzer;
  private reportDetectionBuilder: ReportDetectionBuilder;
  private roleIntakeProcessor: RoleIntakeProcessor;
  private readonly scheduledThreadRepairEventIds = new Set<string>();

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
    this.reportAiAnalyzer = new ReportAiAnalyzer(this.serverRepository, this.gptService);
    this.reportDetectionBuilder = new ReportDetectionBuilder(
      this.detectionEventsRepository,
      this.reportAiAnalyzer
    );
    this.roleIntakeProcessor = new RoleIntakeProcessor(
      this.verificationEventRepository,
      (member, moderator, options) => this.openAdminCase(member, moderator, options)
    );
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
      metadata: withDetectionTestingMetadata(
        messageContent ? { content: messageContent } : undefined,
        'server'
      ),
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
  ): Promise<Message> {
    const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
      member,
      detectionResult,
      verificationEvent,
      sourceMessage
    );

    if (!notificationMessage) {
      throw new Error('Failed to send or update suspicious user notification');
    }

    if (
      verificationEvent.notification_message_id !== notificationMessage.id ||
      verificationEvent.notification_channel_id !== notificationMessage.channelId
    ) {
      await this.verificationEventRepository.update(verificationEvent.id, {
        notification_channel_id: notificationMessage.channelId,
        notification_message_id: notificationMessage.id,
      });
      verificationEvent.notification_channel_id = notificationMessage.channelId;
      verificationEvent.notification_message_id = notificationMessage.id;
    }

    return notificationMessage;
  }

  private createDetectionResultFromEvent(detectionEvent: DetectionEvent): DetectionResult {
    const metadata = this.metadataToRecord(detectionEvent.metadata);
    const content = typeof metadata.content === 'string' ? metadata.content : undefined;

    return {
      label: 'SUSPICIOUS',
      confidence: detectionEvent.confidence,
      reasons: detectionEvent.reasons,
      triggerSource: detectionEvent.detection_type,
      triggerContent: content ?? '',
      detectionEventId: detectionEvent.id,
      reportAiAnalysis: this.reportAiAnalyzer.getAnalysisFromMetadata(metadata),
    };
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...(metadata as Record<string, unknown>) };
  }

  private buildUserSnapshot(member: GuildMember): Record<string, string> {
    const user = member.user as User & { globalName?: string | null };
    const snapshot: Record<string, string> = {
      id: user.id,
      tag: user.tag,
      username: user.username,
      captured_at: new Date().toISOString(),
    };

    if (member.displayName) {
      snapshot.display_name = member.displayName;
    }
    if (user.globalName) {
      snapshot.global_name = user.globalName;
    }
    if (member.nickname) {
      snapshot.nickname = member.nickname;
    }
    if (member.joinedAt) {
      snapshot.joined_at = member.joinedAt.toISOString();
    }

    const createdTimestamp = user.createdTimestamp;
    if (Number.isFinite(createdTimestamp)) {
      snapshot.account_created_at = new Date(createdTimestamp).toISOString();
    }

    const memberDisplayAvatarURL = (member as { displayAvatarURL?: unknown }).displayAvatarURL;
    const userDisplayAvatarURL = (user as { displayAvatarURL?: unknown }).displayAvatarURL;
    const avatarUrl =
      typeof memberDisplayAvatarURL === 'function'
        ? (memberDisplayAvatarURL as (options?: { size?: number }) => string).call(member, {
            size: 128,
          })
        : typeof userDisplayAvatarURL === 'function'
          ? (userDisplayAvatarURL as () => string).call(user)
          : null;
    if (avatarUrl) {
      snapshot.avatar_url = avatarUrl;
    }

    return snapshot;
  }

  private withUserSnapshot(
    metadata: VerificationEvent['metadata'],
    member: GuildMember
  ): VerificationEvent['metadata'] {
    return {
      ...this.metadataToRecord(metadata),
      user_snapshot: this.buildUserSnapshot(member),
    } as VerificationEvent['metadata'];
  }

  private async refreshVerificationUserSnapshot(
    verificationEvent: VerificationEvent,
    member: GuildMember
  ): Promise<VerificationEvent> {
    try {
      const updated = await this.verificationEventRepository.update(
        verificationEvent.id,
        {
          metadata: this.withUserSnapshot(verificationEvent.metadata, member),
        },
        { touchUpdatedAt: false }
      );

      return updated ?? verificationEvent;
    } catch (error) {
      console.warn(`Failed to refresh user snapshot for case ${verificationEvent.id}:`, error);
      return verificationEvent;
    }
  }

  private shouldUseReportReviewThread(): boolean {
    return false;
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
  ): Promise<VerificationEvent> {
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

    return verificationEvent;
  }

  private async tryCreatePrivateEvidenceThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    notificationMessage: Message,
    sourceMessage?: Message
  ): Promise<VerificationEvent> {
    try {
      const thread = await this.threadManager.createPrivateEvidenceThread(
        member,
        verificationEvent,
        detectionResult,
        notificationMessage,
        sourceMessage
      );
      if (!thread) {
        throw new Error(`Failed to create admin evidence thread for ${member.user.tag}`);
      }
      return verificationEvent;
    } catch (error) {
      console.error(
        `Failed to create admin evidence thread for ${member.user.tag}; continuing case flow:`,
        error
      );
      return this.recordVerificationActionFailure(
        verificationEvent,
        'private_evidence_thread',
        error
      );
    }
  }

  private async ensurePrivateEvidenceThread(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    notificationMessage: Message,
    sourceMessage?: Message
  ): Promise<VerificationEvent> {
    if (verificationEvent.private_evidence_thread_id) {
      return verificationEvent;
    }

    return this.tryCreatePrivateEvidenceThread(
      member,
      verificationEvent,
      detectionResult,
      notificationMessage,
      sourceMessage
    );
  }

  private async upsertNotificationAndEnsurePrivateEvidenceThread(
    member: GuildMember,
    detectionResult: DetectionResult,
    verificationEvent: VerificationEvent,
    sourceMessage?: Message
  ): Promise<VerificationEvent> {
    const notificationMessage = await this.upsertNotification(
      member,
      detectionResult,
      verificationEvent,
      sourceMessage
    );
    const previousPrivateEvidenceThreadId = verificationEvent.private_evidence_thread_id;
    const previousMetadata = verificationEvent.metadata;

    const updatedEvent = await this.ensurePrivateEvidenceThread(
      member,
      verificationEvent,
      detectionResult,
      notificationMessage,
      sourceMessage
    );

    if (
      updatedEvent.private_evidence_thread_id !== previousPrivateEvidenceThreadId ||
      updatedEvent.metadata !== previousMetadata
    ) {
      await this.upsertNotification(member, detectionResult, updatedEvent, sourceMessage);
    }

    return updatedEvent;
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

  private async clearResolvedVerificationActionFailures(
    verificationEvent: VerificationEvent,
    actions: readonly VerificationActionFailureKind[]
  ): Promise<VerificationEvent> {
    const hasFailuresToClear = getVerificationActionFailures(verificationEvent.metadata).some(
      (failure) => actions.includes(failure.action)
    );
    if (!hasFailuresToClear) {
      return verificationEvent;
    }

    const updatedMetadata = clearVerificationActionFailures(verificationEvent.metadata, actions);
    const fallbackEvent = {
      ...verificationEvent,
      metadata: updatedMetadata as VerificationEvent['metadata'],
    };

    try {
      const updatedEvent = await this.verificationEventRepository.update(verificationEvent.id, {
        metadata: updatedMetadata as VerificationEvent['metadata'],
      });

      return updatedEvent ?? fallbackEvent;
    } catch (error) {
      console.error(
        `Failed to clear resolved action failures for verification event ${verificationEvent.id}; continuing repair flow:`,
        error
      );
      return fallbackEvent;
    }
  }

  private hasVerificationActionFailure(
    verificationEvent: VerificationEvent,
    action: VerificationActionFailureKind
  ): boolean {
    return getVerificationActionFailures(verificationEvent.metadata).some(
      (failure) => failure.action === action
    );
  }

  private scheduleDelayedThreadRepair(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): void {
    if (!this.hasVerificationActionFailure(verificationEvent, 'thread')) {
      return;
    }
    if (this.scheduledThreadRepairEventIds.has(verificationEvent.id)) {
      return;
    }

    this.scheduledThreadRepairEventIds.add(verificationEvent.id);
    const timer = setTimeout(() => {
      void this.runDelayedThreadRepair(
        member,
        verificationEvent.id,
        detectionResult,
        sourceMessage
      ).finally(() => {
        this.scheduledThreadRepairEventIds.delete(verificationEvent.id);
      });
    }, DELAYED_THREAD_REPAIR_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
  }

  private async runDelayedThreadRepair(
    member: GuildMember,
    verificationEventId: string,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<void> {
    const verificationEvent = await this.verificationEventRepository.findById(verificationEventId);
    if (!verificationEvent || verificationEvent.status !== VerificationStatus.PENDING) {
      return;
    }
    if (!this.hasVerificationActionFailure(verificationEvent, 'thread')) {
      return;
    }

    try {
      const repair = await this.threadManager.repairVerificationThread(member, verificationEvent);
      if (!repair.threadId || !repair.userAdded) {
        throw new Error('Delayed verification thread repair did not complete thread setup');
      }

      const repairedEvent =
        (await this.verificationEventRepository.findById(verificationEventId)) ?? verificationEvent;
      const clearedEvent = await this.clearResolvedVerificationActionFailures(repairedEvent, [
        'thread',
      ]);
      await this.upsertNotificationAndEnsurePrivateEvidenceThread(
        member,
        detectionResult,
        clearedEvent,
        sourceMessage
      );
    } catch (error) {
      console.error(
        `Delayed verification thread repair failed for verification event ${verificationEventId}:`,
        error
      );
    }
  }

  private async tryRestrictUser(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<VerificationEvent> {
    try {
      const restricted = moderator
        ? await this.userModerationService.restrictUser(member, moderator)
        : await this.userModerationService.restrictUser(member);
      if (!restricted) {
        throw new Error(`Failed to restrict user ${member.user.tag}`);
      }
      return verificationEvent;
    } catch (error) {
      console.error(`Failed to restrict user ${member.user.tag}; continuing case flow:`, error);
      return this.recordVerificationActionFailure(verificationEvent, 'restrict', error);
    }
  }

  private requireModerationSuccess(succeeded: boolean, action: string, member: GuildMember): void {
    if (!succeeded) {
      throw new Error(`Failed to ${action} user ${member.user.tag}`);
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
      let updatedEvent = await this.createCaseThread(
        member,
        verificationEvent,
        detectionResult,
        useReportReviewThread,
        sourceMessage
      );
      return updatedEvent;
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
    detectionEventId: string,
    sourceMessage?: Message
  ): Promise<void> {
    const activeVerificationEvent =
      await this.verificationEventRepository.findActiveByUserAndServer(member.id, member.guild.id);

    if (!activeVerificationEvent) {
      const notificationMessage =
        await this.notificationManager.upsertObservedDetectionNotification(member, detectionResult);
      if (!notificationMessage) {
        throw new Error('Failed to send or update report observed alert');
      }
      await this.ensureObservedEvidenceThread(
        member,
        detectionResult,
        notificationMessage,
        sourceMessage
      );
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

  private async ensureObservedEvidenceThread(
    member: GuildMember,
    detectionResult: DetectionResult,
    notificationMessage: Message,
    sourceMessage?: Message
  ): Promise<void> {
    if (!detectionResult.detectionEventId) {
      return;
    }

    try {
      const detectionEvent = await this.detectionEventsRepository.findById(
        detectionResult.detectionEventId
      );
      const metadata = this.metadataToRecord(detectionEvent?.metadata);
      if (typeof metadata.observed_evidence_thread_id === 'string') {
        return;
      }

      const thread = await this.threadManager.createObservedEvidenceThread(
        member,
        detectionResult,
        notificationMessage,
        sourceMessage
      );
      if (!thread) {
        return;
      }

      await this.detectionEventsRepository.updateMetadata(detectionResult.detectionEventId, {
        ...metadata,
        observed_evidence_thread_id: thread.id,
      });
    } catch (error) {
      console.error(
        `Failed to create observed evidence thread for ${member.user.tag}; continuing observed alert flow:`,
        error
      );
    }
  }

  private async routeConfirmedReportIntake(
    member: GuildMember,
    detectionResult: DetectionResult,
    detectionEventId: string
  ): Promise<void> {
    const server = await this.serverRepository.findByGuildId(member.guild.id);
    const intakeSettings = getReportIntakeSettings(server?.settings);
    const reportAiSettings = getReportAiSettings(server?.settings);
    const route = this.resolveConfirmedReportIntakeRoute(
      intakeSettings.confirmedResponseMode,
      reportAiSettings,
      detectionResult.reportAiAnalysis
    );

    if (route === 'observed_alert') {
      await this.upsertReportObservedAlertOrActiveCase(member, detectionResult, detectionEventId);
      return;
    }

    const handled = await this.handleSuspiciousMember(
      member,
      detectionResult,
      undefined,
      route === 'restrict',
      false,
      true
    );
    if (!handled) {
      throw new Error(`Failed to route confirmed report intake as ${route}`);
    }
  }

  private resolveConfirmedReportIntakeRoute(
    configuredMode: 'observed_alert' | 'open_case' | 'restrict',
    reportAiSettings: ReturnType<typeof getReportAiSettings>,
    reportAiAnalysis?: ReportAIAnalysis
  ): 'observed_alert' | 'open_case' | 'restrict' {
    if (configuredMode === 'observed_alert') {
      return 'observed_alert';
    }

    if (!reportAiAnalysis) {
      this.warnConfirmedReportIntakeFallback(configuredMode, reportAiSettings.maxAction);
      return 'observed_alert';
    }

    if (
      configuredMode === 'restrict' &&
      reportAiSettings.maxAction === 'restrict' &&
      reportAiAnalysis.recommendedAction === 'restrict' &&
      reportAiAnalysis.confidence >= reportAiSettings.restrictThreshold
    ) {
      return 'restrict';
    }

    if (
      (reportAiSettings.maxAction === 'open_case' || reportAiSettings.maxAction === 'restrict') &&
      (reportAiAnalysis.recommendedAction === 'open_case' ||
        reportAiAnalysis.recommendedAction === 'restrict') &&
      reportAiAnalysis.confidence >= reportAiSettings.openCaseThreshold
    ) {
      return 'open_case';
    }

    this.warnConfirmedReportIntakeFallback(configuredMode, reportAiSettings.maxAction);

    return 'observed_alert';
  }

  private warnConfirmedReportIntakeFallback(
    configuredMode: 'open_case' | 'restrict',
    maxAction: string
  ): void {
    console.warn(
      `[ReportIntake] confirmedResponseMode is '${configuredMode}' but maxAction ('${maxAction}') or AI analysis did not meet thresholds; falling back to observed_alert.`
    );
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

    if (detectionEvent.server_id === guildId) {
      return detectionEvent;
    }

    if (detectionEvent.server_id === null && this.isGlobalAuditAdmin(moderatorId)) {
      return detectionEvent;
    }

    return null;
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
    const shouldUseReviewThread = useReportReviewThread ?? this.shouldUseReportReviewThread();
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

    let notificationVerificationEvent = verificationEvent;
    if (
      !verificationEvent.thread_id ||
      (!shouldUseReviewThread && this.hasReportReviewThread(verificationEvent))
    ) {
      notificationVerificationEvent = await this.tryCreateCaseThread(
        member,
        verificationEvent,
        detectionResult,
        shouldUseReviewThread
      );
      await this.upsertNotification(member, detectionResult, notificationVerificationEvent);
      if (!shouldUseReviewThread) {
        this.scheduleDelayedThreadRepair(member, notificationVerificationEvent, detectionResult);
      }
    }

    return notificationVerificationEvent;
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
    const metadata = this.getDetectionMetadataSnapshot(detectionEvent);

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

  private getDetectionMetadataSnapshot(detectionEvent: DetectionEvent): Record<string, unknown> {
    return detectionEvent.metadata &&
      typeof detectionEvent.metadata === 'object' &&
      !Array.isArray(detectionEvent.metadata)
      ? { ...detectionEvent.metadata }
      : {};
  }

  private async rollbackDetectionMetadata(detectionEvent: DetectionEvent): Promise<void> {
    await this.detectionEventsRepository.updateMetadata(
      detectionEvent.id,
      this.getDetectionMetadataSnapshot(detectionEvent)
    );
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
    useReportReviewThread?: boolean,
    entitiesAlreadyEnsured = false,
    moderator?: User
  ): Promise<boolean> {
    const shouldUseReviewThread = useReportReviewThread ?? this.shouldUseReportReviewThread();

    if (!entitiesAlreadyEnsured) {
      // Create durable case state before Discord side effects so moderators see partial failures.
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );
    }

    const detectionEventId = await this.ensureDetectionEventId(
      member,
      detectionResult,
      sourceMessage
    );

    const activeVerificationEvent =
      await this.verificationEventRepository.findActiveByUserAndServer(member.id, member.guild.id);

    if (activeVerificationEvent) {
      let notificationVerificationEvent = await this.refreshVerificationUserSnapshot(
        activeVerificationEvent,
        member
      );
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
      if (
        !shouldUseReviewThread &&
        (!notificationVerificationEvent.thread_id ||
          this.hasReportReviewThread(notificationVerificationEvent))
      ) {
        notificationVerificationEvent = await this.tryCreateCaseThread(
          member,
          notificationVerificationEvent,
          detectionResult,
          false,
          sourceMessage
        );
      }
      if (restrictUser) {
        const serverMember = await this.serverMemberRepository.findByServerAndUser(
          member.guild.id,
          member.id
        );
        if (serverMember?.is_restricted !== true) {
          notificationVerificationEvent = await this.tryRestrictUser(
            member,
            notificationVerificationEvent,
            moderator
          );
        }
      }
      notificationVerificationEvent = await this.upsertNotificationAndEnsurePrivateEvidenceThread(
        member,
        detectionResult,
        notificationVerificationEvent,
        sourceMessage
      );
      if (!shouldUseReviewThread) {
        this.scheduleDelayedThreadRepair(
          member,
          notificationVerificationEvent,
          detectionResult,
          sourceMessage
        );
      }
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
    newVerificationEvent = await this.refreshVerificationUserSnapshot(newVerificationEvent, member);

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
      newVerificationEvent = await this.tryRestrictUser(member, newVerificationEvent, moderator);
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

    newVerificationEvent = await this.upsertNotificationAndEnsurePrivateEvidenceThread(
      member,
      detectionResult,
      newVerificationEvent,
      sourceMessage
    );
    if (!shouldUseReviewThread) {
      this.scheduleDelayedThreadRepair(
        member,
        newVerificationEvent,
        detectionResult,
        sourceMessage
      );
    }
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

  public async openAdminCase(
    member: GuildMember,
    moderator: User,
    options: AdminCaseOptions
  ): Promise<AdminCaseResult> {
    try {
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      const restrictUser = options.action === 'restrict';
      const normalizedReason = options.reason?.trim() || undefined;
      const isRoleIntake = options.metadata?.type === 'admin_role_intake';
      const sourceRoleId =
        typeof options.metadata?.sourceRoleId === 'string' ? options.metadata.sourceRoleId : null;
      const reasonSuffix = normalizedReason ? ` Reason: ${normalizedReason}` : '';
      const reasonText = isRoleIntake
        ? sourceRoleId
          ? `Role intake from <@&${sourceRoleId}> started by <@${moderator.id}>.${reasonSuffix}`
          : `Role intake started by <@${moderator.id}>.${reasonSuffix}`
        : `Admin case opened by <@${moderator.id}>.${reasonSuffix}`;
      const triggerContent = isRoleIntake
        ? sourceRoleId
          ? `Role intake from <@&${sourceRoleId}> by <@${moderator.id}>${normalizedReason ? `: ${normalizedReason}` : ''}`
          : `Role intake by <@${moderator.id}>${normalizedReason ? `: ${normalizedReason}` : ''}`
        : `Opened by <@${moderator.id}>${normalizedReason ? `: ${normalizedReason}` : ''}`;
      const detectionType = isRoleIntake ? DetectionType.ROLE_INTAKE : DetectionType.ADMIN_CASE;
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: member.guild.id,
        user_id: member.id,
        detection_type: detectionType,
        confidence: 1.0,
        reasons: [reasonText],
        detected_at: new Date(),
        metadata: withDetectionTestingMetadata(
          {
            type: 'admin_case',
            ...options.metadata,
            adminId: moderator.id,
            action: options.action,
            reason: normalizedReason ?? 'No reason provided.',
          },
          'server'
        ),
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [reasonText],
        triggerSource: detectionType,
        triggerContent,
        detectionEventId: detectionEvent.id,
      };

      const handled = await this.handleSuspiciousMember(
        member,
        detectionResult,
        undefined,
        restrictUser,
        undefined,
        true,
        moderator
      );
      if (handled) {
        this.captureMemberAnalytics(
          member,
          restrictUser ? 'admin case opened with restriction' : 'admin case opened',
          {
            has_reason: Boolean(normalizedReason),
            bulk_intake: options.metadata?.bulk_intake === true,
          },
          {
            moderatorId: moderator.id,
            detectionEventId: detectionEvent.id,
          }
        );
      }
      const serverMember = restrictUser
        ? await this.serverMemberRepository.findByServerAndUser(member.guild.id, member.id)
        : null;
      return {
        opened: handled,
        restrictionAttempted: restrictUser,
        restricted: serverMember?.is_restricted === true,
      };
    } catch (error) {
      console.error(`Failed to open admin case for ${member.user.tag}:`, error);
      throw error;
    }
  }

  public async repairActiveCase(member: GuildMember): Promise<ActiveCaseRepairResult> {
    const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
      member.id,
      member.guild.id
    );
    if (!activeCase) {
      return {
        repaired: false,
        message: `No active verification case found for ${member.user.tag}.`,
        threadId: null,
        threadCreated: false,
        userAdded: false,
        promptSent: false,
        promptAlreadyPresent: false,
      };
    }

    if (this.hasReportReviewThread(activeCase)) {
      return {
        repaired: false,
        message:
          'Active case uses a moderator-only report review thread; no user-facing verification thread repair was attempted.',
        verificationEventId: activeCase.id,
        threadId: activeCase.thread_id,
        threadCreated: false,
        userAdded: false,
        promptSent: false,
        promptAlreadyPresent: false,
      };
    }

    let repairCase = activeCase;
    const serverMember = await this.serverMemberRepository.findByServerAndUser(
      member.guild.id,
      member.id
    );
    if (serverMember?.is_restricted === true) {
      repairCase = await this.tryRestrictUser(member, activeCase);
    }

    const threadRepair = await this.threadManager.repairVerificationThread(member, repairCase);
    if (!threadRepair.threadId) {
      return {
        ...threadRepair,
        repaired: false,
        message: `Could not create or repair the verification thread for ${member.user.tag}.`,
        verificationEventId: repairCase.id,
      };
    }

    repairCase = await this.clearResolvedVerificationActionFailures(repairCase, ['thread']);

    let notificationUpdateMessage = '';
    try {
      await this.notificationManager.updateNotificationButtons(
        repairCase,
        VerificationStatus.PENDING
      );
    } catch (error) {
      notificationUpdateMessage = ' Notification buttons could not be updated automatically.';
      console.error(
        `Failed to update notification for repaired case ${repairCase.id}; continuing repair flow:`,
        error
      );
    }

    return {
      ...threadRepair,
      repaired: true,
      message: `Repaired active verification case for ${member.user.tag}.${notificationUpdateMessage}`,
      verificationEventId: repairCase.id,
    };
  }

  public async refreshCaseNotification(
    guildId: string,
    user: User,
    verificationEventId?: string
  ): Promise<CaseNotificationRefreshResult> {
    const verificationEvent = verificationEventId
      ? await this.verificationEventRepository.findById(verificationEventId)
      : ((await this.verificationEventRepository.findByUserAndServer(user.id, guildId))[0] ?? null);

    if (
      !verificationEvent ||
      verificationEvent.server_id !== guildId ||
      verificationEvent.user_id !== user.id
    ) {
      return {
        refreshed: false,
        message: verificationEventId
          ? `No matching case ${verificationEventId} found for ${user.tag}.`
          : `No verification case found for ${user.tag}.`,
      };
    }

    if (!verificationEvent.notification_message_id) {
      return {
        refreshed: false,
        message: `Case ${verificationEvent.id} has no stored notification message to refresh.`,
        verificationEventId: verificationEvent.id,
        status: verificationEvent.status,
        notificationMessageId: null,
        notificationChannelId: verificationEvent.notification_channel_id,
      };
    }

    try {
      await this.notificationManager.updateNotificationButtons(
        verificationEvent,
        verificationEvent.status
      );
      return {
        refreshed: true,
        message: `Refreshed ${verificationEvent.status} case notification for ${user.tag}.`,
        verificationEventId: verificationEvent.id,
        status: verificationEvent.status,
        notificationMessageId: verificationEvent.notification_message_id,
        notificationChannelId: verificationEvent.notification_channel_id,
      };
    } catch (error) {
      console.error(`Failed to refresh case notification ${verificationEvent.id}:`, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        refreshed: false,
        message: `Failed to refresh case ${verificationEvent.id} notification: ${message}`,
        verificationEventId: verificationEvent.id,
        status: verificationEvent.status,
        notificationMessageId: verificationEvent.notification_message_id,
        notificationChannelId: verificationEvent.notification_channel_id,
      };
    }
  }

  public async restrictActiveCase(member: GuildMember, moderator: User): Promise<boolean> {
    const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
      member.id,
      member.guild.id
    );
    if (!activeCase) {
      throw new Error(`No active verification case found for ${member.user.tag}.`);
    }

    const serverMember = await this.serverMemberRepository.findByServerAndUser(
      member.guild.id,
      member.id
    );
    if (serverMember?.is_restricted === true) {
      return true;
    }

    await this.ensureUserFacingThreadForRestriction(member, activeCase);
    const restricted = await this.userModerationService.restrictUser(member, moderator);
    this.requireModerationSuccess(restricted, 'restrict', member);

    return true;
  }

  private async ensureUserFacingThreadForRestriction(
    member: GuildMember,
    activeCase: VerificationEvent
  ): Promise<VerificationEvent> {
    try {
      if (this.hasReportReviewThread(activeCase)) {
        const thread = await this.threadManager.createVerificationThread(member, activeCase);
        if (!thread) {
          throw new Error(`Failed to create verification thread for ${member.user.tag}`);
        }
        return await this.clearResolvedVerificationActionFailures(activeCase, ['thread']);
      }

      const repair = await this.threadManager.repairVerificationThread(member, activeCase);
      if (!repair.threadId) {
        throw new Error(`Failed to create or repair verification thread for ${member.user.tag}`);
      }
      return await this.clearResolvedVerificationActionFailures(activeCase, ['thread']);
    } catch (error) {
      console.error(
        `Failed to ensure user-facing case thread before restricting ${member.user.tag}; continuing restriction:`,
        error
      );
      return this.recordVerificationActionFailure(activeCase, 'thread', error);
    }
  }

  public async intakeRoleMembers(options: RoleIntakeOptions): Promise<RoleIntakeResult> {
    return await this.roleIntakeProcessor.intakeRoleMembers(options);
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

      const normalizedReason = reason?.trim() || undefined;
      const reasonText = `Manually flagged by <@${moderator.id}>.${normalizedReason ? ` Reason: ${normalizedReason}` : ''}`;
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: member.guild.id,
        user_id: member.id,
        detection_type: DetectionType.ADMIN_FLAG,
        confidence: 1.0,
        reasons: [reasonText],
        detected_at: new Date(),
        metadata: withDetectionTestingMetadata(
          {
            type: 'admin_flag',
            adminId: moderator.id,
            reason: normalizedReason ?? 'No reason provided.',
          },
          'server'
        ),
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [reasonText],
        triggerSource: DetectionType.ADMIN_FLAG,
        triggerContent: `Flagged by <@${moderator.id}>${normalizedReason ? `: ${normalizedReason}` : ''}`,
        detectionEventId: detectionEvent.id,
      };

      const handled = await this.handleSuspiciousMember(
        member,
        detectionResult,
        undefined,
        true,
        undefined,
        true,
        moderator
      );
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

      const { detectionEvent, detectionResult } =
        await this.reportDetectionBuilder.createUserReportDetection(member, reporter, reason);

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

  public async handleConfirmedReportIntake(
    member: GuildMember,
    reporter: User,
    report: ConfirmedReportIntakeContext
  ): Promise<boolean> {
    try {
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      const existingDetectionEvent = report.intakeId
        ? await this.detectionEventsRepository.findByReportIntakeId(report.intakeId)
        : null;
      if (
        existingDetectionEvent &&
        existingDetectionEvent.server_id === member.guild.id &&
        existingDetectionEvent.user_id === member.id
      ) {
        const detectionResult =
          this.reportDetectionBuilder.createUserReportDetectionResult(existingDetectionEvent);
        await this.routeConfirmedReportIntake(member, detectionResult, existingDetectionEvent.id);
        return true;
      }

      const { detectionEvent, detectionResult } =
        await this.reportDetectionBuilder.createUserReportDetection(
          member,
          reporter,
          report.reason,
          {
            attachments: report.attachments,
            metadata: {
              source: 'report_intake',
              ...(report.intakeId ? { reportIntakeId: report.intakeId } : {}),
            },
          }
        );

      await this.routeConfirmedReportIntake(member, detectionResult, detectionEvent.id);
      this.captureMemberAnalytics(
        member,
        'report intake submitted',
        {
          report_type: 'report_intake',
          has_reason: Boolean(report.reason?.trim()),
          has_attachments: Boolean(report.attachments?.length),
        },
        {
          reporterId: reporter.id,
          detectionEventId: detectionEvent.id,
        }
      );
      return true;
    } catch (error) {
      console.error(`Failed to handle confirmed report intake for ${member.user.tag}:`, error);
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

      const globalReport = await this.reportDetectionBuilder.createGlobalMessageReportDetection(
        targetUser,
        reporter,
        report
      );

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

    const serverDetectionEvent =
      await this.reportDetectionBuilder.createManagedMessageReportDetection(
        member,
        reporter,
        report,
        globalReportId,
        isLocalReport
      );
    const detectionResult = this.reportDetectionBuilder.createManagedMessageReportDetectionResult(
      serverDetectionEvent,
      reporter,
      report,
      isLocalReport
    );

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
      const restricted = await this.userModerationService.restrictUser(member);
      this.requireModerationSuccess(restricted, 'restrict', member);
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
      const banned = await this.userModerationService.banUser(
        member,
        reason,
        moderator,
        detectionEvent.id
      );
      this.requireModerationSuccess(banned, 'ban', member);
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
        moderator
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
    const updatedDetectionEvent = await this.detectionEventsRepository.markExcludedFromAccounting(
      detectionEvent.id,
      createAccountingExclusionMetadata(moderator.id, accountingReason, accountingScope)
    );
    if (!updatedDetectionEvent) {
      return null;
    }

    try {
      await this.recordObservedAction({
        serverId: detectionEvent.server_id,
        userId: detectionEvent.user_id,
        moderator,
        detectionEvent: updatedDetectionEvent,
        actionType: AdminActionType.FALSE_POSITIVE,
        notes: accountingReason,
      });
    } catch (error) {
      await this.rollbackDetectionMetadata(detectionEvent);
      throw error;
    }

    return updatedDetectionEvent;
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
    const observedAction = this.getObservedAction(detectionEvent);
    const updatedDetectionEvent = await this.detectionEventsRepository.clearAccountingExclusion(
      detectionEvent.id
    );
    if (!updatedDetectionEvent) {
      return null;
    }

    let actionRecorded = false;
    try {
      await this.recordObservedAction({
        serverId: detectionEvent.server_id,
        userId: detectionEvent.user_id,
        moderator,
        detectionEvent: updatedDetectionEvent,
        actionType: AdminActionType.UNDO_OBSERVED_ACTION,
        notes: reason?.trim() || 'Restored detection to future accounting.',
      });
      actionRecorded = true;
      if (observedAction === AdminActionType.FALSE_POSITIVE) {
        await this.notificationManager.restoreObservedDetectionActions(
          detectionEvent.id,
          'restored this detection to future accounting',
          moderator
        );
      }
    } catch (error) {
      if (!actionRecorded) {
        await this.rollbackDetectionMetadata(detectionEvent);
      }
      throw error;
    }

    return updatedDetectionEvent;
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
