import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { AdminAction, AdminActionCreate, AdminActionType } from '../repositories/types';

export interface IAdminActionService {
  recordAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionsByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  getActionsForUser(serverId: string, userId: string): Promise<AdminAction[]>;
  formatActionSummary(action: AdminAction): string;
}

/**
 * AdminActionService - Handles auditing of actions taken by admins
 */
@injectable()
export class AdminActionService implements IAdminActionService {
  constructor(
    @inject(TYPES.AdminActionRepository) private adminActionRepository: IAdminActionRepository,
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) private serverRepository: IServerRepository
  ) {}

  async recordAction(data: AdminActionCreate): Promise<AdminAction> {
    // Ensure server and user exist
    const [server, user] = await Promise.all([
      this.serverRepository.findById(data.server_id),
      this.userRepository.findById(data.user_id),
    ]);

    if (!server) {
      throw new Error(`Server ${data.server_id} not found`);
    }
    if (!user) {
      throw new Error(`User ${data.user_id} not found`);
    }

    // Create the admin action
    return this.adminActionRepository.createAction(data);
  }

  async getActionsByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]> {
    return this.adminActionRepository.findByAdmin(adminId, options);
  }

  async getActionsForUser(serverId: string, userId: string): Promise<AdminAction[]> {
    return this.adminActionRepository.findByUserAndServer(userId, serverId);
  }

  formatActionSummary(action: AdminAction): string {
    const timestamp = new Date(action.action_at).toLocaleString();
    const adminMention = `<@${action.admin_id}>`;
    let summary = '';

    switch (action.action_type) {
      case AdminActionType.VERIFY:
        summary = `✅ Verified by ${adminMention}`;
        break;
      case AdminActionType.REJECT:
        summary = `❌ Rejected by ${adminMention}`;
        break;
      case AdminActionType.BAN:
        summary = `🔨 Banned by ${adminMention}`;
        break;
      case AdminActionType.REOPEN:
        summary = `🔄 Verification reopened by ${adminMention}`;
        break;
      case AdminActionType.CREATE_THREAD:
        summary = `📝 Verification thread created by ${adminMention}`;
        break;
      default:
        summary = `Action taken by ${adminMention}`;
    }

    summary += ` at ${timestamp}`;

    if (action.previous_status !== action.new_status) {
      // action.previous_status is always a truthy enum string, so `|| 'none'` is unnecessary.
      summary += `\nStatus changed from ${action.previous_status} to ${action.new_status}`;
    }

    if (action.notes) {
      summary += `\nNotes: ${action.notes}`;
    }

    return summary;
  }
}
