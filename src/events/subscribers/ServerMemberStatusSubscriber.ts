// src/events/subscribers/ServerMemberStatusSubscriber.ts
import { injectable, inject } from 'inversify';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, UserVerifiedPayload, UserBannedPayload } from '../events';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { VerificationStatus } from '../../repositories/types'; // Import local enum

@injectable()
export class ServerMemberStatusSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
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
      `ServerMemberStatusSubscriber: Handling ${EventNames.UserVerified} for user ${payload.userId}`
    );
    try {
      // Update the server member record to reflect verification
      await this.serverMemberRepository.upsertMember(payload.serverId, payload.userId, {
        is_restricted: false, // User is no longer restricted
        verification_status: VerificationStatus.VERIFIED, // Set status to verified
        last_status_change: new Date(),
        last_verified_at: new Date().toISOString(), // Record verification time
      });
      console.log(
        `ServerMemberStatusSubscriber: Updated server member status to VERIFIED for user ${payload.userId}.`
      );
    } catch (error) {
      console.error(
        `ServerMemberStatusSubscriber: Error updating status for verified user ${payload.userId}:`,
        error
      );
    }
  }

  private async handleUserBanned(payload: UserBannedPayload): Promise<void> {
    console.log(
      `ServerMemberStatusSubscriber: Handling ${EventNames.UserBanned} for user ${payload.userId}`
    );
    try {
      // Update the server member record to reflect ban
      await this.serverMemberRepository.upsertMember(payload.serverId, payload.userId, {
        // is_restricted: true, // Keep restricted? Or remove member record? Let's keep restricted for now.
        verification_status: VerificationStatus.BANNED, // Set status to banned
        last_status_change: new Date(),
      });
      console.log(
        `ServerMemberStatusSubscriber: Updated server member status to BANNED for user ${payload.userId}.`
      );
    } catch (error) {
      console.error(
        `ServerMemberStatusSubscriber: Error updating status for banned user ${payload.userId}:`,
        error
      );
    }
  }
}
