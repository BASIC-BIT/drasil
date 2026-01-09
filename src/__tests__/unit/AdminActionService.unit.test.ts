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
      action_type: AdminActionType.VERIFY,
      previous_status: VerificationStatus.PENDING,
      new_status: VerificationStatus.VERIFIED,
      notes: 'ok',
    });

    const actions = await adminActionRepository.findByAdmin('admin-2');
    expect(actions).toHaveLength(1);
    expect(action.action_type).toBe(AdminActionType.VERIFY);
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
});
