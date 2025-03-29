/**
 * SecurityActionService: Handles security responses to detection results
 * - Receives detection results from DetectionOrchestrator
 * - Ensures core entities exist in database
 * - Handles the appropriate actions (assigning roles, sending notifications, etc.)
 * - Coordinates between RoleManager and NotificationManager
 */
import { injectable, inject } from 'inversify';
import { GuildMember, Message, ThreadChannel, User } from 'discord.js';
import { TYPES } from '../di/symbols';
import { IRoleManager } from './RoleManager';
import { INotificationManager } from './NotificationManager';
import { DetectionResult } from './DetectionOrchestrator';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IUserService } from './UserService';
import { IServerService } from './ServerService';

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
  handleSuspiciousJoin(
    member: GuildMember,
    detectionResult: DetectionResult
  ): Promise<boolean>;

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
  private roleManager: IRoleManager;
  private notificationManager: INotificationManager;
  private detectionEventsRepository: IDetectionEventsRepository;
  private serverMemberRepository: IServerMemberRepository;
  private userService: IUserService;
  private serverService: IServerService;

  constructor(
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.ServerService) serverService: IServerService
  ) {
    this.roleManager = roleManager;
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.userService = userService;
    this.serverService = serverService;
  }
  
  /**
   * Initialize the service with server-specific configurations
   * 
   * @param serverId The Discord server ID
   */
  public async initialize(serverId: string): Promise<void> {
    await this.roleManager.initialize(serverId);
    await this.notificationManager.initialize(serverId);
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
   * Record a detection event in the database
   * 
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param detectionResult The detection result
   * @param messageContent Optional message content that triggered the detection
   * @param messageId Optional message ID that triggered the detection
   * @param channelId Optional channel ID that triggered the detection
   */
  private async recordDetectionEvent(
    serverId: string,
    userId: string,
    detectionResult: DetectionResult,
    messageContent?: string,
    messageId?: string,
    channelId?: string
  ): Promise<void> {
    await this.detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: detectionResult.triggerSource,
      confidence: detectionResult.confidence,
      confidence_level: detectionResult.confidence >= 0.8 ? 'High' : detectionResult.confidence >= 0.5 ? 'Medium' : 'Low',
      reasons: detectionResult.reasons,
      used_gpt: detectionResult.usedGPT,
      detected_at: new Date(),
      message_id: messageId,
      channel_id: channelId,
      metadata: messageContent ? { content: messageContent } : undefined
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
      // Ensure all required entities exist first
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      console.log(`User flagged for spam: ${member.user.tag} (${member.id})`);
      console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      console.log(`Reasons: ${detectionResult.reasons.join(', ')}`);
      console.log(`Trigger source: ${detectionResult.triggerSource}`);

      // Record the detection event
      await this.recordDetectionEvent(
        member.guild.id,
        member.id,
        detectionResult,
        sourceMessage?.content,
        sourceMessage?.id,
        sourceMessage?.channelId
      );

      // Assign restricted role to the member
      const restrictSuccess = await this.roleManager.assignRestrictedRole(member);
      if (restrictSuccess) {
        console.log(`Assigned restricted role to ${member.user.tag}`);
      } else {
        console.log(`Failed to assign restricted role to ${member.user.tag}`);
        return false;
      }

      // Get existing verification message ID if it exists
      const existingMember = await this.serverMemberRepository.findByServerAndUser(member.guild.id, member.id);
      const existingMessageId = existingMember?.verification_message_id;

      // Create or update notification
      const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
        member,
        detectionResult,
        existingMessageId,
        sourceMessage
      );

      if (notificationMessage) {
        console.log(`Sent/Updated notification about ${member.user.tag}`);
        
        // Store the verification message ID
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          verification_message_id: notificationMessage.id
        });
        
        return true;
      } else {
        console.log(`Failed to send/update notification about ${member.user.tag}`);
        return false;
      }
    } catch (error) {
      console.error('Failed to handle suspicious message:', error);
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
      // Ensure all required entities exist first
      await this.ensureEntitiesExist(
        member.guild.id,
        member.id,
        member.user.username,
        member.joinedAt?.toISOString()
      );

      console.log(`New member flagged as suspicious: ${member.user.tag} (${member.id})`);
      console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
      console.log(`Reasons: ${detectionResult.reasons.join(', ')}`);
      console.log(`Trigger source: ${detectionResult.triggerSource}`);

      // Record the detection event
      await this.recordDetectionEvent(
        member.guild.id,
        member.id,
        detectionResult
      );

      // Assign restricted role
      const restrictSuccess = await this.roleManager.assignRestrictedRole(member);
      if (restrictSuccess) {
        console.log(`Assigned restricted role to ${member.user.tag}`);
      } else {
        console.log(`Failed to assign restricted role to ${member.user.tag}`);
        return false;
      }

      // Get existing verification message ID if it exists
      const existingMember = await this.serverMemberRepository.findByServerAndUser(member.guild.id, member.id);
      const existingMessageId = existingMember?.verification_message_id;

      // Create or update notification
      const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
        member,
        detectionResult,
        existingMessageId
      );

      if (notificationMessage) {
        console.log(`Sent/Updated notification about ${member.user.tag}`);

        // Store the verification message ID
        await this.serverMemberRepository.upsertMember(member.guild.id, member.id, {
          verification_message_id: notificationMessage.id
        });

        // Automatically create a verification thread for new joins
        await this.createVerificationThreadForMember(
          member, 
          notificationMessage
        );
        
        return true;
      } else {
        console.log(`Failed to send/update notification about ${member.user.tag}`);
        return false;
      }
    } catch (error) {
      console.error('Failed to handle suspicious join:', error);
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
      console.log(`Created verification thread for ${member.user.tag}`);
      
      // If we have a notification message and an action performer, log the action
      if (notificationMessage && actionPerformer) {
        await this.notificationManager.logActionToMessage(
          notificationMessage,
          'created a verification thread',
          actionPerformer,
          thread
        );
      } else if (notificationMessage) {
        // Use "automatically created" message if no explicit performer
        const actionMessage = actionPerformer ? 'created a verification thread' : 'automatically created a verification thread';
        await this.notificationManager.logActionToMessage(
          notificationMessage,
          actionMessage,
          actionPerformer || member.client.user,
          thread
        );
      }
      return thread;
    } else {
      console.log(`Failed to create verification thread for ${member.user.tag}`);
      return null;
    }
  }
} 