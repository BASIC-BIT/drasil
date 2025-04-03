// src/events/subscribers/RoleUpdateSubscriber.ts
import { injectable, inject } from 'inversify';
import { Client } from 'discord.js';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, UserVerifiedPayload } from '../events';
import { IRoleManager } from '../../services/RoleManager';

@injectable()
export class RoleUpdateSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.RoleManager) private roleManager: IRoleManager,
    @inject(TYPES.DiscordClient) private client: Client // Inject Client to fetch member
  ) {
    this.subscribe();
  }

  private subscribe(): void {
    this.eventBus.subscribe(EventNames.UserVerified, this.handleUserVerified.bind(this));
    // Potentially subscribe to UserBanned if roles need changing on ban (e.g., adding a 'Banned' role)
  }

  private async handleUserVerified(payload: UserVerifiedPayload): Promise<void> {
    console.log(
      `RoleUpdateSubscriber: Handling ${EventNames.UserVerified} for user ${payload.userId}`
    );
    try {
      const guild = await this.client.guilds.fetch(payload.serverId);
      if (!guild) {
        console.error(`RoleUpdateSubscriber: Guild ${payload.serverId} not found.`);
        return;
      }
      const member = await guild.members.fetch(payload.userId);
      if (!member) {
        // User might have left after verification but before event processing
        console.warn(
          `RoleUpdateSubscriber: Member ${payload.userId} not found in guild ${payload.serverId} during verification role removal.`
        );
        return;
      }

      const success = await this.roleManager.removeRestrictedRole(member);
      if (success) {
        console.log(
          `RoleUpdateSubscriber: Successfully removed restricted role from user ${payload.userId}.`
        );
      } else {
        console.error(
          `RoleUpdateSubscriber: Failed to remove restricted role from user ${payload.userId}.`
        );
      }
    } catch (error) {
      // Handle cases where member might not be fetchable (e.g., left server)
      if (error instanceof Error && error.message.includes('Unknown Member')) {
        console.warn(
          `RoleUpdateSubscriber: Member ${payload.userId} likely left server ${payload.serverId} before role removal.`
        );
      } else {
        console.error(
          `RoleUpdateSubscriber: Error handling ${EventNames.UserVerified} for user ${payload.userId}:`,
          error
        );
      }
    }
  }
}
