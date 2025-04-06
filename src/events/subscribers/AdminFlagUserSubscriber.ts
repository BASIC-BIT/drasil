import { inject, injectable } from 'inversify';
import { TYPES } from '../../di/symbols';
import { IEventBus } from '../EventBus';
import { EventNames, AdminFlagUserRequestedPayload, UserDetectedSuspiciousPayload } from '../events';
import { IDetectionEventsRepository } from '../../repositories/DetectionEventsRepository';
import { DetectionResult } from '../../services/DetectionOrchestrator'; // Removed DetectionSource
import { IUserRepository } from '../../repositories/UserRepository';
import { IServerRepository } from '../../repositories/ServerRepository';
import { IServerMemberRepository } from '../../repositories/ServerMemberRepository';
import { DetectionType } from '../../repositories/types'; // Added import
import 'reflect-metadata';

export interface IAdminFlagUserSubscriber {
  subscribe(): void;
}

@injectable()
export class AdminFlagUserSubscriber implements IAdminFlagUserSubscriber {
  constructor(
    @inject(TYPES.EventBus) private eventBus: IEventBus,
    @inject(TYPES.DetectionEventsRepository)
    private detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}

  subscribe(): void {
    this.eventBus.subscribe(
      EventNames.AdminFlagUserRequested,
      this.handleAdminFlagUserRequested.bind(this)
    );
    console.log(`[AdminFlagUserSubscriber] Subscribed to ${EventNames.AdminFlagUserRequested}`);
  }

  private async handleAdminFlagUserRequested(
    payload: AdminFlagUserRequestedPayload
  ): Promise<void> {
    console.log('[AdminFlagUserSubscriber] Handling AdminFlagUserRequested event:', payload);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { targetUserId, serverId, adminId, reason, interactionId } = payload;

    try {
      // 1. Ensure Server, User, and ServerMember exist (create if necessary)
      // REMOVED: Downstream SecurityActionService handles entity existence checks
      // await this.serverRepository.ensureExists(serverId);
      // await this.userRepository.ensureExists(targetUserId);
      // await this.serverMemberRepository.ensureExists(serverId, targetUserId);

      // 2. Create a DetectionEvent for the manual flag
      const detectionEvent = await this.detectionEventsRepository.create({
        server_id: serverId,
        user_id: targetUserId,
        detection_type: DetectionType.GPT_ANALYSIS, // Use a valid type, signifies manual override/analysis
        metadata: { type: 'admin_flag', adminId, reason: reason ?? 'Manual flag by admin' }, // Use metadata field
        confidence: 1.0, // Use confidence field, assign max for manual flag
        // suspicion_score: 1.0, // Removed incorrect field
      });

      // 3. Construct a DetectionResult object
      const detectionResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 1.0, // Max confidence for manual flag
        reasons: [`Manually flagged by admin ${adminId}. ${reason ? `Reason: ${reason}` : ''}`],
        triggerSource: DetectionType.GPT_ANALYSIS, // Added required field
        triggerContent: reason ?? 'Manual Admin Flag', // Added required field
        detectionEventId: detectionEvent.id, // Link to the created event
      };

      // 4. Publish the UserDetectedSuspicious event to trigger the standard flow
      const suspiciousPayload: UserDetectedSuspiciousPayload = {
        userId: targetUserId,
        serverId: serverId,
        detectionResult: detectionResult,
        detectionEventId: detectionEvent.id,
        // No sourceMessageId or channelId for manual flag
      };
      this.eventBus.publish(EventNames.UserDetectedSuspicious, suspiciousPayload);

      console.log(`[AdminFlagUserSubscriber] Published ${EventNames.UserDetectedSuspicious} for user ${targetUserId}`);

      // Optionally, reply to the interaction if needed (might require InteractionReplySubscriber)
      // Example: this.eventBus.publish(EventNames.InteractionReplyRequested, { interactionId, content: 'User flagged successfully.', ephemeral: true });

    } catch (error) {
      console.error('[AdminFlagUserSubscriber] Error handling AdminFlagUserRequested:', error);
      // Optionally, notify the admin via interaction reply about the failure
      // Example: this.eventBus.publish(EventNames.InteractionReplyRequested, { interactionId, content: 'Failed to flag user.', ephemeral: true });
    }
  }
}