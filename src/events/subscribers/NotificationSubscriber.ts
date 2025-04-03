// src/events/subscribers/NotificationSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, VerificationStartedPayload } from '../events';
import { INotificationManager } from '../../services/NotificationManager';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';

@injectable()
export class NotificationSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.NotificationManager) private notificationManager: INotificationManager,
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DiscordClient) private client: Client // Inject Client to fetch member
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(
      EventNames.VerificationStarted,
      this.handleVerificationStarted.bind(this)
    );
  }

  private async handleVerificationStarted(payload: VerificationStartedPayload): Promise<void> {
    console.log(
      `NotificationSubscriber: Handling ${EventNames.VerificationStarted} for user ${payload.userId}`
    );
    try {
      // Fetch member details - needed for the notification content
      const guild = await this.client.guilds.fetch(payload.serverId);
      if (!guild) {
        console.error(`NotificationSubscriber: Guild ${payload.serverId} not found.`);
        return;
      }
      const member = await guild.members.fetch(payload.userId);
      if (!member) {
        console.error(
          `NotificationSubscriber: Member ${payload.userId} not found in guild ${payload.serverId}.`
        );
        return;
      }

      // Send/Update the notification message using data from the payload
      const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
        member,
        payload.detectionResult, // Use detectionResult from the payload
        payload.verificationEvent
      );

      // Link the message ID back to the VerificationEvent
      if (notificationMessage && payload.verificationEvent) {
        try {
          // Only update if the ID is not already set or different
          if (payload.verificationEvent.notification_message_id !== notificationMessage.id) {
            await this.verificationEventRepository.update(payload.verificationEvent.id, {
              notification_message_id: notificationMessage.id,
            });
            console.log(
              `NotificationSubscriber: Linked message ${notificationMessage.id} to verification ${payload.verificationEvent.id}`
            );
          }
        } catch (updateError) {
          console.error(
            `NotificationSubscriber: Failed to link message ID ${notificationMessage.id} to verification ${payload.verificationEvent.id}:`,
            updateError
          );
        }
      } else if (!notificationMessage) {
        console.error(
          `NotificationSubscriber: Failed to send/update notification for verification ${payload.verificationEvent.id}`
        );
      }
    } catch (error) {
      console.error(
        `NotificationSubscriber: Error handling ${EventNames.VerificationStarted} for user ${payload.userId}:`,
        error
      );
    }
  }
}
