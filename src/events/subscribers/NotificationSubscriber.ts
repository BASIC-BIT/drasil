// src/events/subscribers/NotificationSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import {
  EventNames,
  VerificationStartedPayload,
  AdditionalSuspicionDetectedPayload,
} from '../events';
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
    this.eventBus.subscribe(
      // Correctly placed subscription
      EventNames.AdditionalSuspicionDetected,
      this.handleAdditionalSuspicionDetected.bind(this)
    );
  }

  private async handleVerificationStarted(payload: VerificationStartedPayload): Promise<void> {
    console.log(
      `NotificationSubscriber: Handling ${EventNames.VerificationStarted} for user ${payload.userId}`
    );
    // Removed misplaced subscription call from here
    try {
      // Fetch member details - needed for the notification content
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.userId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // Send/Update the notification message using data from the payload
      const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
        member,
        payload.detectionResult, // Use detectionResult from the payload
        payload.verificationEvent
      );

      // Link the message ID back to the VerificationEvent

      // Link the message ID back to the VerificationEvent if both exist
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Check is necessary before accessing properties
      if (notificationMessage && payload.verificationEvent) {
        try {
          // Update the verification event with the message ID
          await this.verificationEventRepository.update(payload.verificationEvent.id, {
            notification_message_id: notificationMessage.id,
          });
          console.log(
            `NotificationSubscriber: Linked message ${notificationMessage.id} to verification ${payload.verificationEvent.id}`
          );
        } catch (updateError) {
          console.error(
            `NotificationSubscriber: Failed to link message ID ${notificationMessage.id} to verification ${payload.verificationEvent.id}:`,
            updateError
          );
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Check is necessary before accessing properties
      } else if (!notificationMessage && payload.verificationEvent) {
        // Log error if message sending failed but we had a verification event
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
  } // End of handleVerificationStarted

  // Method correctly placed inside the class
  private async handleAdditionalSuspicionDetected(
    payload: AdditionalSuspicionDetectedPayload
  ): Promise<void> {
    console.log(
      `NotificationSubscriber: Handling ${EventNames.AdditionalSuspicionDetected} for user ${payload.userId}`
    );
    try {
      // Fetch member details
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.userId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // Update the existing notification message
      const notificationMessage = await this.notificationManager.upsertSuspiciousUserNotification(
        member,
        payload.detectionResult, // Use the new detection result
        payload.existingVerificationEvent, // Use the existing verification event
        payload.sourceMessage // Pass the source message if available
      );

      // Link the message ID back to the existing VerificationEvent
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- notificationMessage can be null
      if (notificationMessage && payload.existingVerificationEvent) {
        try {
          // Only update if the ID is not already set or different
          // Linter believes the !== check is always true. Removing the condition
          // and always performing the update. This is generally safe as the
          // update should be idempotent for this field.
          await this.verificationEventRepository.update(payload.existingVerificationEvent.id, {
            notification_message_id: notificationMessage.id,
          });
          console.log(
            `NotificationSubscriber: Linked/Updated message ${notificationMessage.id} to existing verification ${payload.existingVerificationEvent.id}`
          );
        } catch (updateError) {
          console.error(
            `NotificationSubscriber: Failed to link/update message ID ${notificationMessage.id} to existing verification ${payload.existingVerificationEvent.id}:`,
            updateError
          );
        }
      } else if (!notificationMessage) {
        console.error(
          `NotificationSubscriber: Failed to update notification for existing verification ${payload.existingVerificationEvent.id}`
        );
      }
    } catch (error) {
      console.error(
        `NotificationSubscriber: Error handling ${EventNames.AdditionalSuspicionDetected} for user ${payload.userId}:`,
        error
      );
    }
  } // End of handleAdditionalSuspicionDetected
} // End of class NotificationSubscriber
