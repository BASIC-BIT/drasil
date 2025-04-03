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
  AdminActionType,
} from '../repositories/types';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IThreadManager } from './ThreadManager';
import { IUserModerationService } from './UserModerationService';
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
  private userModerationService: IUserModerationService;
  private client: Client;

  constructor(
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ThreadManager) threadManager: IThreadManager,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.DiscordClient) client: Client
  ) {
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.verificationEventRepository = verificationEventRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.threadManager = threadManager;
    this.userModerationService = userModerationService;
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
      await this.serverMemberRepository.getOrCreateMember(serverId, userId, joinedAt ? new Date(joinedAt) : undefined);
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

        // Update the existing notification
        const updatedMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult, // Use the latest detection result
          activeVerificationEvent,
          sourceMessage
        );

        return !!updatedMessage; // Return success based on notification update
      } else {
        // --- No active verification exists ---
        console.log(
          `No active verification found for user ${member.user.tag}. Creating new event.`
        );

        // Create a NEW VerificationEvent (this also restricts the user)
        let newVerificationEvent: VerificationEvent | null = null;
        try {
          // Add missing serverId and userId arguments
          newVerificationEvent = await this.verificationEventRepository.createFromDetection(
            detectionEvent.id,
            member.guild.id, // serverId
            member.id,       // userId
            VerificationStatus.PENDING
          );
          console.log(
            `Restricted user ${member.user.tag} and created verification event ${newVerificationEvent.id}`
          );
        } catch (error) {
          console.error(
            `Failed to restrict user or create verification event for ${member.user.tag}:`,
            error
          );
          return false; // Stop if restriction/event creation fails
        }

        // Create a NEW notification message
        const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult,
          newVerificationEvent,
          sourceMessage
        );

        // Update the NEW Verification Event with the message ID
        if (notificationMessage && newVerificationEvent) {
          try {
            newVerificationEvent.notification_message_id = notificationMessage.id;
            await this.verificationEventRepository.update(
              newVerificationEvent.id,
              newVerificationEvent
            );
            console.log(
              `Sent notification and linked message ${notificationMessage.id} to verification ${newVerificationEvent.id}`
            );
            return true;
          } catch (updateError) {
            console.error(
              `Sent notification for ${member.user.tag}, but failed to link message ID ${notificationMessage.id} to verification ${newVerificationEvent.id}:`,
              updateError
            );
            return true; // Notification sent is good enough
          }
        } else {
          console.warn(
            `Failed to send notification message for user ${member.user.tag}, verification event ${newVerificationEvent?.id}`
          );
          return false;
        }
      }
    } catch (error) {
      console.error(`Failed to handle suspicious message for ${member?.user?.tag}:`, error);
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

        // Update the existing notification
        const updatedMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult, // Use the latest detection result
          activeVerificationEvent
          // No source message for join
        );

        // If we updated successfully AND the original event was missing a message ID, update it now.
        if (updatedMessage && !activeVerificationEvent.notification_message_id) {
          try {
            activeVerificationEvent.notification_message_id = updatedMessage.id;
            await this.verificationEventRepository.update(
              activeVerificationEvent.id,
              activeVerificationEvent
            );
            console.log(
              `Linked new/updated message ${updatedMessage.id} to existing verification ${activeVerificationEvent.id}`
            );
          } catch (updateError) {
            console.error(
              `Failed to link new/updated message ${updatedMessage.id} to existing verification ${activeVerificationEvent.id}:`,
              updateError
            );
          }
        }
        return !!updatedMessage; // Return success based on notification update
      } else {
        // --- No active verification exists ---
        console.log(
          `No active verification found for user ${member.user.tag}. Creating new event.`
        );

        // Create a NEW VerificationEvent (this also restricts the user)
        let newVerificationEvent: VerificationEvent | null = null;
        try {
          // Add missing serverId and userId arguments
          newVerificationEvent = await this.verificationEventRepository.createFromDetection(
            detectionEvent.id,
            member.guild.id, // serverId
            member.id,       // userId
            VerificationStatus.PENDING
          );
          console.log(
            `Restricted user ${member.user.tag} and created verification event ${newVerificationEvent.id}`
          );
        } catch (error) {
          console.error(
            `Failed to restrict user or create verification event for ${member.user.tag}:`,
            error
          );
          return false; // Stop if restriction/event creation fails
        }

        // Create a NEW notification message
        const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult,
          newVerificationEvent
          // No source message for join
        );

        // Update the NEW Verification Event with the message ID
        if (notificationMessage && newVerificationEvent) {
          try {
            newVerificationEvent.notification_message_id = notificationMessage.id;
            await this.verificationEventRepository.update(
              newVerificationEvent.id,
              newVerificationEvent
            );
            console.log(
              `Sent notification and linked message ${notificationMessage.id} to verification ${newVerificationEvent.id}`
            );
            return true;
          } catch (updateError) {
            console.error(
              `Sent notification for ${member.user.tag}, but failed to link message ID ${notificationMessage.id} to verification ${newVerificationEvent.id}:`,
              updateError
            );
            return true; // Notification sent is good enough
          }
        } else {
          console.warn(
            `Failed to send notification message for user ${member.user.tag}, verification event ${newVerificationEvent?.id}`
          );
          return false;
        }
      }
    } catch (error) {
      console.error(`Failed to handle suspicious join for ${member?.user?.tag}:`, error);
      return false;
    }
  }

  // TODO: check if this is deoing everything it needs to... kinda a lot of concerns?
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
    await this.threadManager.reopenVerificationThread(verificationEvent);

    // TODO: Fetch server member better?
    const guild = await this.client.guilds.fetch(verificationEvent.server_id);
    const member = await guild.members.fetch(verificationEvent.user_id);

    // Update the verification event to pending
    verificationEvent.status = VerificationStatus.PENDING;
    await this.verificationEventRepository.update(verificationEvent.id, verificationEvent);

    // Re-restrict the user
    await this.userModerationService.restrictUser(member);

    // Log the action to the message
    await this.notificationManager.logActionToMessage(
      verificationEvent,
      AdminActionType.REOPEN,
      moderator
    );

    return true;
  }
}
