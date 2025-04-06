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
    console.log('[DEBUG DetectionResultHandlerSubscriber] CONSTRUCTOR CALLED'); // Add log
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
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.userId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // Fetch the source message if applicable
      let sourceMessage;
      if (
        payload.sourceMessageId &&
        payload.detectionResult.triggerSource === DetectionType.SUSPICIOUS_CONTENT
      ) {
        try {
          // Attempt to find the channel first using fetch for potentially better reliability than cache
          const channel = payload.channelId ? await guild.channels.fetch(payload.channelId) : null;
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
