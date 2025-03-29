/**
 * SecurityActionService: Handles security responses to detection results
 * - Receives detection results from DetectionOrchestrator
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

  constructor(
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository
  ) {
    this.roleManager = roleManager;
    this.notificationManager = notificationManager;
    this.detectionEventsRepository = detectionEventsRepository;
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
   * Record a detection event in the database
   * 
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param detectionResult The detection result
   * @param messageContent Optional message content that triggered the detection
   */
  private async recordDetectionEvent(
    serverId: string,
    userId: string,
    detectionResult: DetectionResult,
    messageContent?: string
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
      message_id: messageContent ? crypto.randomUUID() : undefined,
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
    console.log(`User flagged for spam: ${member.user.tag} (${member.id})`);
    console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
    console.log(`Reasons: ${detectionResult.reasons.join(', ')}`);
    console.log(`Trigger source: ${detectionResult.triggerSource}`);

    // Record the detection event
    await this.recordDetectionEvent(
      member.guild.id,
      member.id,
      detectionResult,
      sourceMessage?.content
    );

    // Assign restricted role to the member
    const restrictSuccess = await this.roleManager.assignRestrictedRole(member);
    if (restrictSuccess) {
      console.log(`Assigned restricted role to ${member.user.tag}`);
    } else {
      console.log(`Failed to assign restricted role to ${member.user.tag}`);
      return false;
    }

    // Send notification to admin channel
    const notificationMessage = await this.notificationManager.notifySuspiciousUser(
      member,
      detectionResult,
      sourceMessage // Pass the source message for linking if available
    );

    if (notificationMessage) {
      console.log(`Sent notification to admin channel about ${member.user.tag}`);
      return true;
    } else {
      console.log(`Failed to send notification to admin channel about ${member.user.tag}`);
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

    // Send notification to admin channel
    const notificationMessage = await this.notificationManager.notifySuspiciousUser(
      member,
      detectionResult
    );

    if (notificationMessage) {
      console.log(`Sent notification to admin channel about ${member.user.tag}`);

      // Automatically create a verification thread for new joins
      await this.createVerificationThreadForMember(
        member, 
        notificationMessage
      );
      
      return true;
    } else {
      console.log(`Failed to send notification to admin channel about ${member.user.tag}`);
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