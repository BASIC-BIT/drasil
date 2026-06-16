import { AdminActionService } from '../../services/AdminActionService';
import {
  InMemoryAdminActionRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import { AdminActionType, VerificationStatus } from '../../repositories/types';

describe('AdminActionService (unit)', () => {
  it('throws when server is missing', async () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    await userRepository.getOrCreateUser('user-1', 'test-user');

    await expect(
      service.recordAction({
        server_id: 'missing-server',
        user_id: 'user-1',
        admin_id: 'admin-1',
        verification_event_id: 'ver-1',
        detection_event_id: null,
        action_type: AdminActionType.VERIFY,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.VERIFIED,
        notes: null,
      })
    ).rejects.toThrow('Server missing-server not found');
  });

  it('throws when user is missing', async () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    await serverRepository.getOrCreateServer('server-1');

    await expect(
      service.recordAction({
        server_id: 'server-1',
        user_id: 'missing-user',
        admin_id: 'admin-1',
        verification_event_id: 'ver-1',
        detection_event_id: null,
        action_type: AdminActionType.BAN,
        previous_status: VerificationStatus.PENDING,
        new_status: VerificationStatus.BANNED,
        notes: 'ban reason',
      })
    ).rejects.toThrow('User missing-user not found');
  });

  it('records admin action when server and user exist', async () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    await serverRepository.getOrCreateServer('server-2');
    await userRepository.getOrCreateUser('user-2', 'test-user');

    const action = await service.recordAction({
      server_id: 'server-2',
      user_id: 'user-2',
      admin_id: 'admin-2',
      verification_event_id: 'ver-2',
      detection_event_id: null,
      action_type: AdminActionType.VERIFY,
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.VERIFIED,
      notes: 'ok',
    });

    const actions = await adminActionRepository.findByAdmin('admin-2');
    expect(actions).toHaveLength(1);
    expect(action.action_type).toBe(AdminActionType.VERIFY);
  });

  it('records global admin action without a server', async () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    await userRepository.getOrCreateUser('user-global', 'test-user');

    const action = await service.recordAction({
      server_id: null,
      user_id: 'user-global',
      admin_id: 'admin-global',
      verification_event_id: null,
      detection_event_id: 'det-global',
      action_type: AdminActionType.FALSE_POSITIVE,
      previous_status: null,
      new_status: null,
      notes: 'global false positive',
    });

    expect(action.server_id).toBeNull();
    expect(action.action_type).toBe(AdminActionType.FALSE_POSITIVE);
  });

  it('formats action summary with status change and notes', () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    const summary = service.formatActionSummary({
      id: 'action-1',
      server_id: 'server-1',
      user_id: 'user-1',
      admin_id: 'admin-1',
      verification_event_id: 'ver-1',
      detection_event_id: null,
      action_type: AdminActionType.BAN,
      action_at: new Date('2024-01-01T00:00:00.000Z'),
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.BANNED,
      notes: 'ban reason',
      metadata: null,
    });

    expect(summary).toContain('Banned by <@admin-1>');
    expect(summary).toContain('Status changed from pending to banned');
    expect(summary).toContain('Notes: ban reason');
  });

  it('formats open case summary clearly', () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    const summary = service.formatActionSummary({
      id: 'action-2',
      server_id: 'server-1',
      user_id: 'user-1',
      admin_id: 'admin-1',
      verification_event_id: 'ver-1',
      detection_event_id: 'det-1',
      action_type: AdminActionType.OPEN_CASE,
      action_at: new Date('2024-01-01T00:00:00.000Z'),
      previous_status: null,
      new_status: null,
      notes: null,
      metadata: null,
    });

    expect(summary).toContain('Verification case opened by <@admin-1>');
  });

  it('formats kick summary with a distinct action marker', () => {
    const adminActionRepository = new InMemoryAdminActionRepository();
    const userRepository = new InMemoryUserRepository();
    const serverRepository = new InMemoryServerRepository();
    const service = new AdminActionService(adminActionRepository, userRepository, serverRepository);

    const summary = service.formatActionSummary({
      id: 'action-3',
      server_id: 'server-1',
      user_id: 'user-1',
      admin_id: 'admin-1',
      verification_event_id: 'ver-1',
      detection_event_id: 'det-1',
      action_type: AdminActionType.KICK,
      action_at: new Date('2024-01-01T00:00:00.000Z'),
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.KICKED,
      notes: null,
      metadata: null,
    });

    expect(summary).toContain('👢 Kicked by <@admin-1>');
  });
});
