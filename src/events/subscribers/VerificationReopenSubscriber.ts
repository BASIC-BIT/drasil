// src/events/subscribers/VerificationReopenSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js'; // Removed unused User import
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, VerificationReopenedPayload } from '../events';
import { IThreadManager } from '../../services/ThreadManager';
import { IUserModerationService } from '../../services/UserModerationService';
import { INotificationManager } from '../../services/NotificationManager';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { AdminActionType } from '../../repositories/types';

@injectable()
export class VerificationReopenSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.ThreadManager) private threadManager: IThreadManager,
    @inject(TYPES.UserModerationService) private userModerationService: IUserModerationService,
    @inject(TYPES.NotificationManager) private notificationManager: INotificationManager,
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DiscordClient) private client: Client
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(
      EventNames.VerificationReopened,
      this.handleVerificationReopened.bind(this)
    );
  }

  private async handleVerificationReopened(payload: VerificationReopenedPayload): Promise<void> {
    console.log(
      `VerificationReopenSubscriber: Handling ${EventNames.VerificationReopened} for event ${payload.verificationEventId}`
    );
    try {
      // Fetch the verification event
      const verificationEvent = await this.verificationEventRepository.findById(
        payload.verificationEventId
      );
      if (!verificationEvent) {
        console.error(
          `VerificationReopenSubscriber: Verification event ${payload.verificationEventId} not found.`
        );
        return;
      }

      // Fetch guild, member, and moderator
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.userId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      // Restore fetching the moderator User object
      const moderator = await this.client.users.fetch(payload.moderatorId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      // 1. Reopen the thread
      await this.threadManager.reopenVerificationThread(verificationEvent);

      // 2. Re-restrict the user
      await this.userModerationService.restrictUser(member);

      // 3. Log the action to the message
      await this.notificationManager.logActionToMessage(
        verificationEvent,
        AdminActionType.REOPEN,
        moderator // Pass the fetched moderator object
      );

      console.log(
        `VerificationReopenSubscriber: Successfully reopened verification ${payload.verificationEventId}`
      );
    } catch (error: unknown) {
      // Changed type to unknown
      console.error(
        `VerificationReopenSubscriber: Error handling ${EventNames.VerificationReopened} for event ${payload.verificationEventId}:`
      );
      if (error instanceof Error) {
        console.error(error.message);
        console.error(error.stack);
      } else {
        console.error(error);
      }
      // Removed stray parenthesis from previous diff attempt
    }
  }
}
