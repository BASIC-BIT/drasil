import { inject, injectable } from 'inversify';
import { Client } from 'discord.js'; // Added Client import
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, UserReportSubmittedPayload, UserDetectedSuspiciousPayload } from '../events';
import { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { DetectionResult } from '../../services/DetectionOrchestrator';
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerRepository } from '../../repositories/ServerRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { DetectionType } from '../../repositories/types';
import 'reflect-metadata';

export interface IUserReportSubscriber {
  subscribe(): void;
}

@injectable()
export class UserReportSubscriber implements IUserReportSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.DiscordClient) private client: Client // Added Client injection
  ) {}

  subscribe(): void {
    this.eventBus.subscribe(
      EventNames.UserReportSubmitted,
      this.handleUserReportSubmitted.bind(this)
    );
    console.log(`[UserReportSubscriber] Subscribed to ${EventNames.UserReportSubmitted}`);
  }

  private async handleUserReportSubmitted(payload: UserReportSubmittedPayload): Promise<void> {
    console.log('[UserReportSubscriber] Handling UserReportSubmitted event:', payload);
    const { targetUserInput, serverId, reporterId, reason } = payload;

    try {
      // 1. Resolve the target user ID from the input string
      const targetUserId = await this.resolveUserId(serverId, targetUserInput);

      if (!targetUserId) {
        console.warn(
          `[UserReportSubscriber] Could not resolve user input "${targetUserInput}" in server ${serverId}`
        );
        // Optionally notify the reporter via interaction reply about the failure
        // Example: this.eventBus.publish(EventNames.InteractionReplyRequested, { interactionId, content: `Could not find user matching "${targetUserInput}".`, ephemeral: true });
        return; // Stop processing if user not found
      }

      // 2. Ensure Server, User, and ServerMember exist (create if necessary)
      // REMOVED: Downstream SecurityActionService handles entity existence checks

      // 3. Create a DetectionEvent for the user report
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: serverId,
        user_id: targetUserId, // Use the resolved ID
        detection_type: DetectionType.USER_REPORT, // Use the new type
        confidence: 1.0, // Assign max confidence for user reports initially
        reasons: [`Reported by user ${reporterId}. ${reason ? `Reason: ${reason}` : ''}`],
        detected_at: new Date(),
        metadata: { type: 'user_report', reporterId, reason: reason ?? 'User report' },
      });

      // 4. Construct a DetectionResult object
      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS', // Assume suspicious on user report
        confidence: 1.0,
        reasons: [`Reported by user ${reporterId}. ${reason ? `Reason: ${reason}` : ''}`],
        triggerSource: DetectionType.USER_REPORT,
        triggerContent: reason ?? 'User Report',
        detectionEventId: detectionEvent.id,
      };

      // 5. Publish the UserDetectedSuspicious event to trigger the standard flow
      const suspiciousPayload: UserDetectedSuspiciousPayload = {
        userId: targetUserId, // Use the resolved ID
        serverId: serverId,
        detectionResult: detectionResult,
        detectionEventId: detectionEvent.id,
        // No sourceMessageId or channelId for user report
      };
      this.eventBus.publish(EventNames.UserDetectedSuspicious, suspiciousPayload);

      console.log(
        `[UserReportSubscriber] Published ${EventNames.UserDetectedSuspicious} for user ${targetUserId} based on report by ${reporterId}`
      );
    } catch (error) {
      console.error('[UserReportSubscriber] Error handling UserReportSubmitted:', error);
      // Optionally, notify the reporter via interaction reply about the failure
      // Example: this.eventBus.publish(EventNames.InteractionReplyRequested, { interactionId, content: 'Failed to process user report.', ephemeral: true });
    }
  }

  /**
   * Attempts to resolve a user ID string or tag string to a valid User ID within a guild.
   * Returns the User ID string or null if not found.
   */
  private async resolveUserId(guildId: string, userInput: string): Promise<string | null> {
    userInput = userInput.trim();

    // Check if it's already a valid ID
    if (/^\d{17,19}$/.test(userInput)) {
      try {
        const guild = await this.client.guilds.fetch(guildId);
        await guild.members.fetch(userInput); // Check if member exists in the guild
        return userInput; // It's a valid ID and member exists
      } catch {
        // Invalid ID or member not in guild
        return null;
      }
    }

    // Check if it's a tag (username#discriminator)
    const tagMatch = userInput.match(/^(.+)#(\d{4})$/);
    if (tagMatch) {
      const username = tagMatch[1];
      const discriminator = tagMatch[2];
      try {
        const guild = await this.client.guilds.fetch(guildId);
        // Fetch members and find matching tag - potentially inefficient for large servers
        const members = await guild.members.fetch(); // Might need caching or specific query if possible
        const foundMember = members.find(
          (m) => m.user.username === username && m.user.discriminator === discriminator
        );
        return foundMember ? foundMember.id : null;
      } catch (error) {
        console.error(`[UserReportSubscriber] Error fetching members for tag resolution: ${error}`);
        return null;
      }
    }

    // Could not resolve
    return null;
  }
}
