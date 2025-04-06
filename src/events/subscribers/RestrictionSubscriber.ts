// src/events/subscribers/RestrictionSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, VerificationStartedPayload } from '../events';
import { IUserModerationService } from '../../services/UserModerationService';

@injectable()
export class RestrictionSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.UserModerationService) private userModerationService: IUserModerationService,
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
      `RestrictionSubscriber: Handling ${EventNames.VerificationStarted} for user ${payload.userId}`
    );
    try {
      const guild = await this.client.guilds.fetch(payload.serverId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.
      const member = await guild.members.fetch(payload.userId);
      // If fetch fails, it throws an error caught by the outer try/catch block.
      // No need for a null check here.

      const success = await this.userModerationService.restrictUser(member);
      if (success) {
        console.log(`RestrictionSubscriber: Successfully restricted user ${payload.userId}.`);
      } else {
        console.error(`RestrictionSubscriber: Failed to restrict user ${payload.userId}.`);
      }
    } catch (error) {
      console.error(
        `RestrictionSubscriber: Error handling ${EventNames.VerificationStarted} for user ${payload.userId}:`,
        error
      );
    }
  }
}
