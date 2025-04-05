import { injectable, inject } from 'inversify';
import { GuildMember, Message, Client, User } from 'discord.js';
import { TYPES } from '../di/symbols';
import { INotificationManager } from './NotificationManager';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import {
  DetectionEvent,
  VerificationEvent,
  VerificationStatus,
  // AdminActionType, // Removed as it's no longer used directly here
} from '../repositories/types';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IThreadManager } from './ThreadManager';
import { IUserModerationService } from './UserModerationService';
import { IEventBus } from '../events/EventBus'; // Added EventBus import
import { EventNames } from '../events/events'; // Added EventNames import
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
  private threadManager: IThreadManager;
  private userModerationService: IUserModerationService; // Keep for reopenVerification for now
  private client: Client;
  private eventBus: IEventBus; // Added EventBus

  constructor(
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService, // Keep for reopenVerification
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.EventBus) eventBus: IEventBus // Inject EventBus
  ) {
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.verificationEventRepository = verificationEventRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.threadManager = threadManager;
    this.userModerationService = userModerationService; // Keep for reopenVerification
    this.client = client;
    this.eventBus = eventBus; // Assign EventBus
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
      // 1. Ensure entities exist
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      console.log(`Suspicious message detected for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);

      // 2. Record the DetectionEvent
      const detectionEvent = await this.recordDetectionEvent(
        member.guild.id,
        member.id,
        detectionResult,
        sourceMessage?.content,
        sourceMessage?.id,
        sourceMessage?.channelId
      );

      // 3. Check for an existing active verification event
      const activeVerificationEvent =
        await this.verificationEventRepository.findActiveByUserAndServer(
          member.id,
          member.guild.id
        );

      if (activeVerificationEvent) {
        // --- Active verification exists ---
        console.log(
          `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Reusing notification.`
        );

        // Publish event for additional suspicion
        this.eventBus.publish(EventNames.AdditionalSuspicionDetected, {
          userId: member.id,
          serverId: member.guild.id,
          detectionEventId: detectionEvent.id,
          detectionResult: detectionResult,
          existingVerificationEvent: activeVerificationEvent,
          sourceMessage: sourceMessage,
        });

        // Side effects (updating notification) are now handled by subscribers
        // We can assume success if the event was published
        const updatedMessage = true; // Indicate success for return value consistency

        return !!updatedMessage; // Return success based on notification update
      } else {
        // --- No active verification exists ---
        console.log(
          `No active verification found for user ${member.user.tag}. Creating new event.`
        );

        // Create a NEW VerificationEvent
        let newVerificationEvent: VerificationEvent | null = null;
        try {
          // Corrected createFromDetection call
          newVerificationEvent = await this.verificationEventRepository.createFromDetection(
            detectionEvent.id,
            member.guild.id, // serverId
            member.id, // userId
            VerificationStatus.PENDING
          );
          console.log(`Created verification event ${newVerificationEvent.id}`);

          // Publish VerificationStarted event
          this.eventBus.publish(EventNames.VerificationStarted, {
            userId: member.id,
            serverId: member.guild.id,
            verificationEvent: newVerificationEvent,
            detectionEventId: detectionEvent.id,
            detectionResult: detectionResult, // Added detectionResult
          });
        } catch (error) {
          console.error(`Failed to create verification event for ${member.user.tag}:`, error);
          return false; // Stop if event creation fails
        }

        // Side effects (restriction, notification) are now handled by subscribers listening to VerificationStarted event.

        // If we reached here, the event was published successfully
        return true;
      } // Close the else block for 'No active verification exists'
    } catch (error) {
      console.error(`Failed to handle suspicious message for ${member.user.tag}:`, error);
      return false;
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
      // 1. Ensure entities exist
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      console.log(`Suspicious join detected for: ${member.user.tag} (${member.id})`);
      console.log(`Confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);

      // 2. Record the DetectionEvent
      const detectionEvent = await this.recordDetectionEvent(
        member.guild.id,
        member.id,
        detectionResult
        // No source message for join event
      );

      // 3. Check for an existing active verification event
      const activeVerificationEvent =
        await this.verificationEventRepository.findActiveByUserAndServer(
          member.id,
          member.guild.id
        );

      if (activeVerificationEvent) {
        // --- Active verification exists ---
        console.log(
          `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Reusing notification.`
        );

        // Publish event for additional suspicion
        this.eventBus.publish(EventNames.AdditionalSuspicionDetected, {
          userId: member.id,
          serverId: member.guild.id,
          detectionEventId: detectionEvent.id,
          detectionResult: detectionResult,
          existingVerificationEvent: activeVerificationEvent,
          // No sourceMessage for join event
        });

        // Side effects (updating notification) are now handled by subscribers
        // We can assume success if the event was published
        const updatedMessage = true; // Indicate success for return value consistency

        // Removed the block that tried to update notification_message_id here.
        // This logic will be handled by the NotificationSubscriber listening to AdditionalSuspicionDetected.
        return !!updatedMessage; // Return success based on notification update
      } else {
        // --- No active verification exists ---
        console.log(
          `No active verification found for user ${member.user.tag}. Creating new event.`
        );

        // Create a NEW VerificationEvent
        let newVerificationEvent: VerificationEvent | null = null;
        try {
          // Corrected createFromDetection call
          newVerificationEvent = await this.verificationEventRepository.createFromDetection(
            detectionEvent.id,
            member.guild.id, // serverId
            member.id, // userId
            VerificationStatus.PENDING
          );
          console.log(`Created verification event ${newVerificationEvent.id}`);

          // Publish VerificationStarted event
          this.eventBus.publish(EventNames.VerificationStarted, {
            userId: member.id,
            serverId: member.guild.id,
            verificationEvent: newVerificationEvent,
            detectionEventId: detectionEvent.id,
            detectionResult: detectionResult, // Added detectionResult
          });
        } catch (error) {
          console.error(`Failed to create verification event for ${member.user.tag}:`, error);
          return false; // Error handled in createFromDetection
        }

        // Side effects (restriction, notification) are now handled by subscribers listening to VerificationStarted event.

        // If we reached here, the event was published successfully
        return true;
      } // Close the else block for 'No active verification exists'
    } catch (error) {
      console.error(`Failed to handle suspicious join for ${member.user.tag}:`, error);
      return false;
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
    // TODO: Refactor reopenVerification fully to events
    // Removed: await this.threadManager.reopenVerificationThread(verificationEvent); // Handled by subscriber

    // TODO: Fetch server member better?
    // const guild = await this.client.guilds.fetch(verificationEvent.server_id); // Removed as guild is no longer used directly here
    // const member = await guild.members.fetch(verificationEvent.user_id); // Removed as member is no longer used directly here

    // Update the verification event to pending
    verificationEvent.status = VerificationStatus.PENDING;
    await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);

    // Re-restrict the user
    // Removed: await this.userModerationService.restrictUser(member); // Handled by subscriber

    // Log the action to the message
    // Removed: await this.notificationManager.logActionToMessage(...) // Handled by subscriber

    // Publish VerificationReopened event
    this.eventBus.publish(EventNames.VerificationReopened, {
      verificationEventId: verificationEvent.id,
      userId: verificationEvent.user_id,
      serverId: verificationEvent.server_id,
      moderatorId: moderator.id,
    });

    return true;
  }
}
