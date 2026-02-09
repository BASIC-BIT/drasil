import { injectable, inject } from 'inversify';
import { GuildMember, Message, Client, User } from 'discord.js';
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
import { IThreadManager } from './ThreadManager';
import { IUserModerationService } from './UserModerationService';
import { IAdminActionService } from './AdminActionService';
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

  /**
   * Handle a manual flag initiated by an admin
   */
  handleManualFlag(member: GuildMember, moderator: User, reason?: string): Promise<boolean>;

  /**
   * Handle a user report submitted via modal
   */
  handleUserReport(member: GuildMember, reporter: User, reason?: string): Promise<boolean>;

  /**
   * Reopens a verification event, and re-restricts the user (or unbans them?)
   * @param verificationEvent The verification event to reopen
   * @returns Whether the thread was successfully reopened
   */
  reopenVerification(verificationEvent: VerificationEvent, moderator: User): Promise<boolean>;
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

  private async handleSuspiciousMember(
    member: GuildMember,
    detectionResult: DetectionResult,
    sourceMessage?: Message
  ): Promise<boolean> {
    // Fail fast: we don't attempt retries or compensation yet.
    // TODO: Add retries/idempotency and partial failure handling if needed later.
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
      console.log(
        `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Updating notification.`
      );
      await this.upsertNotification(
        member,
        detectionResult,
        activeVerificationEvent,
        sourceMessage
      );
      return true;
    }

    console.log(
      `No active verification found for user ${member.user.tag}. Creating new verification event.`
    );

    const newVerificationEvent = await this.verificationEventRepository.createFromDetection(
      detectionEventId,
      member.guild.id,
      member.id,
      VerificationStatus.PENDING
    );

    const restricted = await this.userModerationService.restrictUser(member);
    if (!restricted) {
      throw new Error(`Failed to restrict user ${member.user.tag}`);
    }

    const thread = await this.threadManager.createVerificationThread(member, newVerificationEvent);
    if (!thread) {
      throw new Error(`Failed to create verification thread for ${member.user.tag}`);
    }

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
        metadata: { type: 'user_report', reporterId: reporter.id, reason: reason ?? reasonText },
      });

      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0,
        reasons: [`Reported by user ${reporter.id}. ${reasonText}`],
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason ?? 'User report',
        detectionEventId: detectionEvent.id,
      };

      return await this.handleSuspiciousMember(member, detectionResult);
    } catch (error) {
      console.error(`Failed to handle user report for ${member.user.tag}:`, error);
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
