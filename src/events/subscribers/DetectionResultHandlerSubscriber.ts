// src/events/subscribers/DetectionResultHandlerSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, UserDetectedSuspiciousPayload } from '../events';
import { ISecurityActionService } from '../../services/SecurityActionService';
import { DetectionType } from '../../repositories/types';

@injectable()
export class DetectionResultHandlerSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.SecurityActionService) private securityActionService: ISecurityActionService,
    @inject(TYPES.DiscordClient) private client: Client
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(
      EventNames.UserDetectedSuspicious,
      this.handleUserDetectedSuspicious.bind(this)
    );
  }

  private async handleUserDetectedSuspicious(
    payload: UserDetectedSuspiciousPayload
  ): Promise<void> {
    console.log(
      `DetectionResultHandlerSubscriber: Handling ${EventNames.UserDetectedSuspicious} for user ${payload.userId}`
    );
    try {
      // Fetch guild and member
      const guild = await this.client.guilds.fetch(payload.serverId);
      if (!guild) {
        console.error(`DetectionResultHandlerSubscriber: Guild ${payload.serverId} not found.`);
        return;
      }
      const member = await guild.members.fetch(payload.userId);
      if (!member) {
        console.error(
          `DetectionResultHandlerSubscriber: Member ${payload.userId} not found in guild ${payload.serverId}.`
        );
        return;
      }

      // Fetch the source message if applicable
      let sourceMessage;
      if (
        payload.sourceMessageId &&
        payload.detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT
      ) {
        try {
          // Attempt to find the channel first - requires channel ID in payload or detectionResult if possible
          // For now, assume we might need to iterate channels or have the ID somehow
          // This part might need refinement depending on where channelId is available
          const channel = guild.channels.cache.get(payload.channelId || ''); // Use channelId from payload
          if (channel?.isTextBased()) {
            sourceMessage = await channel.messages.fetch(payload.sourceMessageId);
          }
        } catch (msgFetchError) {
          console.warn(
            `DetectionResultHandlerSubscriber: Could not fetch source message ${payload.sourceMessageId}:`,
            msgFetchError
          );
        }
      }

      // Call the appropriate SecurityActionService method based on the trigger source
      if (payload.detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT) {
        await this.securityActionService.handleSuspiciousMessage(
          member,
          payload.detectionResult,
          sourceMessage // Pass fetched message or undefined
        );
      } else if (payload.detectionResult.triggerSource === DetectionType.NEW_ACCOUNT) {
        await this.securityActionService.handleSuspiciousJoin(member, payload.detectionResult);
      } else {
        console.warn(
          `DetectionResultHandlerSubscriber: Unknown trigger source '${payload.detectionResult.triggerSource}' for user ${payload.userId}`
        );
      }
    } catch (error) {
      console.error(
        `DetectionResultHandlerSubscriber: Error handling ${EventNames.UserDetectedSuspicious} for user ${payload.userId}:`,
        error
      );
    }
  }
}
