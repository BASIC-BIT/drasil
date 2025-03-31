/**
 * SecurityActionService: Handles security responses to detection results
 * - Receives detection results from DetectionOrchestrator
 * - Ensures core entities exist in database
 * - Handles the appropriate actions (assigning roles, sending notifications, etc.)
 * - Coordinates between RoleManager and NotificationManager
 */
import { injectable, inject } from 'inversify';
import { GuildMember, Message, ThreadChannel, User, Client } from 'discord.js';
import { TYPES } from '../di/symbols';
import { INotificationManager } from './NotificationManager';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IUserService } from './UserService';
import { IServerService } from './ServerService';
import { IUserModerationService } from './UserModerationService';
import { DetectionType, DetectionEvent, VerificationEvent } from '../repositories/types';
import { IVerificationService } from './VerificationService';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';

/**
 * Interface for the SecurityActionService
 */
export interface ISecurityActionService {
  /**
   * Initialize the service with server-specific configurations
   *
   * @param serverId The Discord server ID
   */
  initialize(serverId: string): Promise<void>;

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
   * Create a verification thread for a member
   *
   * @param member The guild member
   * @param notificationMessage The notification message to update with action
   * @param actionPerformer The user who initiated the action
   * @returns The created thread or null if creation failed
   */
  createVerificationThreadForMember(
    member: GuildMember,
    notificationMessage?: Message,
    actionPerformer?: User
  ): Promise<ThreadChannel | null>;
}

@injectable()
export class SecurityActionService implements ISecurityActionService {
  private notificationManager: INotificationManager;
  private detectionEventsRepository: IDetectionEventsRepository;
  private serverMemberRepository: IServerMemberRepository;
  private userService: IUserService;
  private serverService: IServerService;
  private userModerationService: IUserModerationService;
  private verificationService: IVerificationService;
  private verificationEventRepository: IVerificationEventRepository;
  private client: Client;

  constructor(
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.ServerService) serverService: IServerService,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.VerificationService) verificationService: IVerificationService,
    @inject(TYPES.VerificationEventRepository)
    verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DiscordClient) client: Client
  ) {
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.userService = userService;
    this.serverService = serverService;
    this.userModerationService = userModerationService;
    this.verificationService = verificationService;
    this.verificationEventRepository = verificationEventRepository;
    this.client = client;
  }

  /**
   * Initialize the service with server-specific configurations
   *
   * @param serverId The Discord server ID
   */
  public async initialize(serverId: string): Promise<void> {
    await this.notificationManager.initialize(serverId);
    await this.userModerationService.initialize(serverId);
    console.log(`SecurityActionService initialized for server ${serverId}`);
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
      await this.serverService.getOrCreateServer(serverId);

      // Then, ensure the user exists
      await this.userService.getOrCreateUser(userId, username);

      // Finally, ensure server_member record exists
      await this.userService.getOrCreateMember(serverId, userId, joinedAt);
    } catch (error) {
      console.error('Failed to ensure entities exist:', error);
      throw error;
    }
  }

  /**
   * Maps a trigger source to a DetectionType
   * @param triggerSource The source of the detection
   * @returns The corresponding DetectionType
   */
  private mapTriggerSourceToDetectionType(triggerSource: 'message' | 'join'): DetectionType {
    switch (triggerSource) {
      case 'message':
        return DetectionType.SUSPICIOUS_CONTENT;
      case 'join':
        return DetectionType.NEW_ACCOUNT;
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
      detection_type: this.mapTriggerSourceToDetectionType(detectionResult.triggerSource),
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
      const activeVerificationEvent = await this.verificationService.getActiveVerification(
        member.guild.id,
        member.id
      );

      if (activeVerificationEvent) {
        // --- Active verification exists ---
        console.log(
          `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Reusing notification.`
        );

        // Update the existing notification
        const existingMessageId = activeVerificationEvent.notification_message_id;
        const updatedMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult, // Use the latest detection result
          existingMessageId ?? undefined, // Pass existing ID if available
          sourceMessage
        );

        // If we updated successfully AND the original event was missing a message ID, update it now.
        if (updatedMessage && !existingMessageId) {
          try {
            await this.verificationEventRepository.update(activeVerificationEvent.id, {
              notification_message_id: updatedMessage.id,
            });
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
          newVerificationEvent = await this.verificationService.createVerificationEvent(
            member,
            detectionEvent.id // Link the current detection event
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
          undefined, // No existing message ID
          sourceMessage
        );

        // Update the NEW Verification Event with the message ID
        if (notificationMessage && newVerificationEvent) {
          try {
            await this.verificationEventRepository.update(newVerificationEvent.id, {
              notification_message_id: notificationMessage.id,
            });
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
      const activeVerificationEvent = await this.verificationService.getActiveVerification(
        member.guild.id,
        member.id
      );

      if (activeVerificationEvent) {
        // --- Active verification exists ---
        console.log(
          `Active verification ${activeVerificationEvent.id} found for user ${member.user.tag}. Reusing notification.`
        );

        // Update the existing notification
        const existingMessageId = activeVerificationEvent.notification_message_id;
        const updatedMessage = await this.notificationManager.upsertSuspiciousUserNotification(
          member,
          detectionResult, // Use the latest detection result
          existingMessageId ?? undefined // Pass existing ID if available
          // No source message for join
        );

        // If we updated successfully AND the original event was missing a message ID, update it now.
        if (updatedMessage && !existingMessageId) {
          try {
            await this.verificationEventRepository.update(activeVerificationEvent.id, {
              notification_message_id: updatedMessage.id,
            });
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
          newVerificationEvent = await this.verificationService.createVerificationEvent(
            member,
            detectionEvent.id // Link the current detection event
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
          undefined // No existing message ID
          // No source message for join
        );

        // Update the NEW Verification Event with the message ID
        if (notificationMessage && newVerificationEvent) {
          try {
            await this.verificationEventRepository.update(newVerificationEvent.id, {
              notification_message_id: notificationMessage.id,
            });
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

  /**
   * Create a verification thread for a member
   *
   * @param member The guild member
   * @param notificationMessage The notification message to update with action
   * @param actionPerformer The user who initiated the action
   * @returns The created thread or null if creation failed
   */
  public async createVerificationThreadForMember(
    member: GuildMember,
    notificationMessage?: Message,
    actionPerformer?: User
  ): Promise<ThreadChannel | null> {
    const thread = await this.notificationManager.createVerificationThread(member);

    if (thread) {
      console.log(`Created verification thread for ${member.user.tag}: ${thread.id}`);

      // Log action if possible
      if (notificationMessage && actionPerformer) {
        await this.notificationManager.logActionToMessage(
          notificationMessage,
          'created a verification thread',
          actionPerformer,
          thread
        );
      } else if (notificationMessage) {
        // Default to bot user if no performer specified
        const performer = actionPerformer || this.client.user;
        if (performer) {
          // Check if bot user exists
          await this.notificationManager.logActionToMessage(
            notificationMessage,
            'created a verification thread',
            performer,
            thread
          );
        }
      }

      // Link thread ID to verification event (Optional - depends on if needed)
      // const activeVerification = await this.verificationService.getActiveVerification(member.guild.id, member.id);
      // if (activeVerification) {
      //   try {
      //      await this.verificationEventRepository.update(activeVerification.id, { thread_id: thread.id });
      //   } catch (err) {
      //      console.error(`Failed to link thread ${thread.id} to verification event ${activeVerification.id}`);
      //   }
      // }

      return thread;
    } else {
      console.log(`Failed to create verification thread for ${member.user.tag}`);
      return null;
    }
  }
}
