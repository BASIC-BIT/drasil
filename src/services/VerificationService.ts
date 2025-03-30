import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IRoleManager } from './RoleManager';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import {
  VerificationEvent,
  VerificationEventWithActions,
  VerificationStatus,
  AdminActionType,
} from '../repositories/types';

export interface IVerificationService {
  createVerificationEvent(
    serverId: string,
    userId: string,
    detectionEventId: string
  ): Promise<VerificationEvent>;
  getActiveVerification(serverId: string, userId: string): Promise<VerificationEvent | null>;
  verifyUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  rejectUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  reopenVerification(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent>;
  getVerificationHistory(
    serverId: string,
    userId: string
  ): Promise<Array<VerificationEventWithActions>>;
  attachThreadToVerification(
    verificationEventId: string,
    threadId: string
  ): Promise<VerificationEvent>;
}

@injectable()
export class VerificationService implements IVerificationService {
  constructor(
    @inject(TYPES.VerificationEventRepository)
    private verificationEventRepository: IVerificationEventRepository,
    @inject(TYPES.AdminActionRepository) private adminActionRepository: IAdminActionRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository,
    @inject(TYPES.RoleManager) private roleManager: IRoleManager,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}

  async createVerificationEvent(
    serverId: string,
    userId: string,
    detectionEventId: string
  ): Promise<VerificationEvent> {
    // Create the verification event
    const verificationEvent = await this.verificationEventRepository.createFromDetection(
      detectionEventId,
      VerificationStatus.PENDING
    );

    // Update server member status
    await this.serverMemberRepository.updateRestrictionStatus(serverId, userId, true);

    // Assign restricted role
    await this.roleManager.assignRestrictedRole(serverId, userId);

    return verificationEvent;
  }

  async getActiveVerification(serverId: string, userId: string): Promise<VerificationEvent | null> {
    return this.verificationEventRepository.findActiveByUserAndServer(userId, serverId);
  }

  async verifyUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent> {
    // Get active verification event
    const activeVerification = await this.getActiveVerification(serverId, userId);
    if (!activeVerification) {
      throw new Error('No active verification event found');
    }

    // Update verification status
    const updatedVerification = await this.verificationEventRepository.updateStatus(
      activeVerification.id,
      VerificationStatus.VERIFIED,
      adminId,
      notes
    );

    // Record admin action
    await this.adminActionRepository.createAction({
      server_id: serverId,
      user_id: userId,
      admin_id: adminId,
      verification_event_id: activeVerification.id,
      action_type: AdminActionType.VERIFY,
      previous_status: activeVerification.status,
      new_status: VerificationStatus.VERIFIED,
      notes,
      action_at: new Date().toISOString(),
      metadata: {},
    });

    // Remove restricted role
    await this.roleManager.removeRestrictedRole(serverId, userId);

    // Update server member status
    await this.serverMemberRepository.updateRestrictionStatus(serverId, userId, false);

    return updatedVerification;
  }

  async rejectUser(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent> {
    const activeVerification = await this.getActiveVerification(serverId, userId);
    if (!activeVerification) {
      throw new Error('No active verification event found');
    }

    const updatedVerification = await this.verificationEventRepository.updateStatus(
      activeVerification.id,
      VerificationStatus.REJECTED,
      adminId,
      notes
    );

    await this.adminActionRepository.createAction({
      server_id: serverId,
      user_id: userId,
      admin_id: adminId,
      verification_event_id: activeVerification.id,
      action_type: AdminActionType.REJECT,
      previous_status: activeVerification.status,
      new_status: VerificationStatus.REJECTED,
      notes,
      action_at: new Date().toISOString(),
      metadata: {},
    });

    // Keep the restricted role in place for rejected users
    // Update server member status to reflect rejection
    await this.serverMemberRepository.updateRestrictionStatus(serverId, userId, true);

    return updatedVerification;
  }

  async reopenVerification(
    serverId: string,
    userId: string,
    adminId: string,
    notes?: string
  ): Promise<VerificationEvent> {
    // Find the most recent verification event, regardless of status
    const verificationEvents = await this.verificationEventRepository.findByUserAndServer(
      userId,
      serverId,
      { limit: 1 }
    );
    if (!verificationEvents.length) {
      throw new Error('No verification event found');
    }

    const lastVerification = verificationEvents[0];

    // Create a new verification event with PENDING status
    const newVerification = await this.verificationEventRepository.createFromDetection(
      lastVerification.detection_event_id || '',
      VerificationStatus.PENDING
    );

    // Record admin action
    await this.adminActionRepository.createAction({
      server_id: serverId,
      user_id: userId,
      admin_id: adminId,
      verification_event_id: newVerification.id,
      action_type: AdminActionType.REOPEN,
      previous_status: lastVerification.status,
      new_status: VerificationStatus.PENDING,
      notes,
      action_at: new Date().toISOString(),
      metadata: {},
    });

    // Reassign restricted role
    await this.roleManager.assignRestrictedRole(serverId, userId);

    // Update server member status
    await this.serverMemberRepository.updateRestrictionStatus(serverId, userId, true);

    return newVerification;
  }

  async getVerificationHistory(
    serverId: string,
    userId: string
  ): Promise<Array<VerificationEventWithActions>> {
    const verificationEvents = await this.verificationEventRepository.getVerificationHistory(
      userId,
      serverId
    );

    // For each verification event, get its associated admin actions
    const verificationEventsWithActions = await Promise.all(
      verificationEvents.map(async (event) => {
        const actions = await this.adminActionRepository.findByVerificationEvent(event.id);
        return {
          ...event,
          actions,
        };
      })
    );

    return verificationEventsWithActions;
  }

  async attachThreadToVerification(
    verificationEventId: string,
    threadId: string
  ): Promise<VerificationEvent> {
    const verificationEvent = await this.verificationEventRepository.findById(verificationEventId);
    if (!verificationEvent) {
      throw new Error('Verification event not found');
    }

    const updatedEvent = await this.verificationEventRepository.update(verificationEventId, {
      ...verificationEvent,
      thread_id: threadId,
    });

    return updatedEvent;
  }
}
