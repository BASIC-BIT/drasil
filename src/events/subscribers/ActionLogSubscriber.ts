// src/events/subscribers/ActionLogSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client, User } from 'discord.js'; // Import Client and User
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, UserVerifiedPayload, UserBannedPayload } from '../events';
import { INotificationManager } from '../../services/NotificationManager';
import { IVerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { AdminActionType } from '../../repositories/types';

@injectable()
export class ActionLogSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.NotificationManager) private notificationManager: INotificationManager,
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.DiscordClient) private client: Client // Inject Client to fetch moderator User object
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(EventNames.UserVerified, this.handleUserVerified.bind(this));
    this.eventBus.subscribe(EventNames.UserBanned, this.handleUserBanned.bind(this));
    // TODO: Subscribe to UserReopened event when created
  }

  private async handleUserVerified(payload: UserVerifiedPayload): Promise<void> {
    console.log(
      `ActionLogSubscriber: Handling ${EventNames.UserVerified} for user ${payload.userId}`
    );
    await this.logAction(AdminActionType.VERIFY, payload.moderatorId, payload.verificationEventId);
  }

  private async handleUserBanned(payload: UserBannedPayload): Promise<void> {
    console.log(
      `ActionLogSubscriber: Handling ${EventNames.UserBanned} for user ${payload.userId}`
    );
    await this.logAction(AdminActionType.BAN, payload.moderatorId, payload.verificationEventId);
  }

  private async logAction(
    actionType: AdminActionType,
    moderatorId: string,
    verificationEventId?: string
  ): Promise<void> {
    if (!verificationEventId || verificationEventId === 'N/A') {
      console.warn(
        `ActionLogSubscriber: Cannot log action ${actionType} without a valid verificationEventId.`
      );
      return;
    }
    try {
      const verificationEvent =
        await this.verificationEventRepository.findById(verificationEventId);
      if (!verificationEvent) {
        console.error(
          `ActionLogSubscriber: Verification event ${verificationEventId} not found for logging action ${actionType}.`
        );
        return;
      }

      // Fetch the moderator User object
      let moderator: User | null = null;
      try {
        moderator = await this.client.users.fetch(moderatorId);
      } catch (fetchError) {
        console.error(
          `ActionLogSubscriber: Could not fetch moderator user ${moderatorId}:`,
          fetchError
        );
        // Decide if we should proceed without the moderator object or return
        // For logging, it might be acceptable to proceed with just the ID if fetching fails
        // For now, let's proceed but log the error clearly.
        // We might need a placeholder User object or handle this in logActionToMessage
      }

      if (!moderator) {
        // If fetching failed, create a placeholder User object with just the ID for logging purposes
        moderator = { id: moderatorId } as User; // This is a partial mock, use with caution
        console.warn(
          `ActionLogSubscriber: Proceeding to log action ${actionType} with only moderator ID ${moderatorId}.`
        );
      }

      const success = await this.notificationManager.logActionToMessage(
        verificationEvent,
        actionType,
        moderator // Pass the fetched or placeholder User object
      );

      if (success) {
        console.log(
          `ActionLogSubscriber: Successfully logged action ${actionType} for verification ${verificationEventId}.`
        );
      } else {
        console.error(
          `ActionLogSubscriber: Failed to log action ${actionType} for verification ${verificationEventId}.`
        );
      }
    } catch (error) {
      console.error(
        `ActionLogSubscriber: Error logging action ${actionType} for verification ${verificationEventId}:`,
        error
      );
    }
  }
}
