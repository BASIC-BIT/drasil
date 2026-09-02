import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IAdminActionRepository } from '../repositories/AdminActionRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { AdminAction, AdminActionCreate, AdminActionType } from '../repositories/types';

const CAPTCHA_SYSTEM_ACTOR_ID = 'drasil:captcha';
const CAPTCHA_SYSTEM_ACTOR_LABEL = 'Drasil browser check';

export interface IAdminActionService {
  recordAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionsByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  getActionsForUser(serverId: string, userId: string): Promise<AdminAction[]>;
  getActionsForVerificationEvent?(verificationEventId: string): Promise<AdminAction[]>;
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
      data.server_id ? this.serverRepository.findById(data.server_id) : Promise.resolve(null),
      data.user_id ? this.userRepository.findById(data.user_id) : Promise.resolve(null),
    ]);

    if (data.server_id && !server) {
      throw new Error(`Server ${data.server_id} not found`);
    }
    if (data.user_id && !user) {
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

  async getActionsForVerificationEvent(verificationEventId: string): Promise<AdminAction[]> {
    return this.adminActionRepository.findByVerificationEvent(verificationEventId);
  }

  formatActionSummary(action: AdminAction): string {
    const timestamp = new Date(action.action_at).toLocaleString();
    const adminLabel =
      action.admin_id === CAPTCHA_SYSTEM_ACTOR_ID
        ? CAPTCHA_SYSTEM_ACTOR_LABEL
        : `<@${action.admin_id}>`;
    let summary = '';

    switch (action.action_type) {
      case AdminActionType.VERIFY:
        summary = `✅ Verified by ${adminLabel}`;
        break;
      case AdminActionType.REJECT:
        summary = `❌ Rejected by ${adminLabel}`;
        break;
      case AdminActionType.BAN:
        summary = `🔨 Banned by ${adminLabel}`;
        break;
      case AdminActionType.KICK:
        summary = `👢 Kicked by ${adminLabel}`;
        break;
      case AdminActionType.CLOSE_NO_ACTION:
        summary = `Closed with no action by ${adminLabel}`;
        break;
      case AdminActionType.REOPEN:
        summary = `🔄 Verification reopened by ${adminLabel}`;
        break;
      case AdminActionType.CREATE_THREAD:
        summary = `📝 Verification thread created by ${adminLabel}`;
        break;
      case AdminActionType.OPEN_CASE:
        summary = `📝 Verification case opened by ${adminLabel}`;
        break;
      case AdminActionType.RESTRICT:
        summary = `🔒 Case role applied by ${adminLabel}`;
        break;
      case AdminActionType.LIFT_RESTRICTION:
        summary = `🔓 Case role removed by ${adminLabel}`;
        break;
      case AdminActionType.DISMISS:
        summary = `Dismissed by ${adminLabel}`;
        break;
      case AdminActionType.FALSE_POSITIVE:
        summary = `Marked false positive by ${adminLabel}`;
        break;
      case AdminActionType.UNDO_OBSERVED_ACTION:
        summary = `Observed alert action undone by ${adminLabel}`;
        break;
      case AdminActionType.ROLE_GATE_CLEANUP:
        summary = `Role gate cleanup by ${adminLabel}`;
        break;
      case AdminActionType.QUARANTINE_COMPROMISED_ACCOUNT:
        summary = `Compromised account quarantined by ${adminLabel}`;
        break;
      default:
        summary = `Action taken by ${adminLabel}`;
    }

    summary += ` at ${timestamp}`;

    if (
      action.previous_status &&
      action.new_status &&
      action.previous_status !== action.new_status
    ) {
      // action.previous_status is always a truthy enum string, so `|| 'none'` is unnecessary.
      summary += `\nStatus changed from ${action.previous_status} to ${action.new_status}`;
    }

    if (action.notes) {
      summary += `\nNotes: ${action.notes}`;
    }

    return summary;
  }
}
