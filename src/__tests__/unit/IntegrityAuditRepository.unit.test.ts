import { IntegrityAuditRepository } from '../../repositories/IntegrityAuditRepository';
import { RoleQuarantineSnapshotStatus } from '../../repositories/types';

describe('IntegrityAuditRepository (unit)', () => {
  it('loads active snapshots for parked cases omitted by the independent snapshot limit', async () => {
    const parkedCase = {
      id: 'parked-case',
      attention_state: 'parked',
      admin_actions: [],
      moderation_outcomes: [],
    };
    const unrelatedSnapshot = {
      id: 'snapshot-other',
      verification_event_id: 'other-case',
      status: RoleQuarantineSnapshotStatus.ACTIVE,
    };
    const parkedSnapshot = {
      id: 'snapshot-parked',
      verification_event_id: parkedCase.id,
      status: RoleQuarantineSnapshotStatus.ACTIVE,
    };
    const prisma = {
      verification_events: {
        findMany: jest.fn().mockResolvedValueOnce([parkedCase]).mockResolvedValueOnce([]),
      },
      server_members: { findMany: jest.fn().mockResolvedValue([]) },
      role_quarantine_snapshots: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([unrelatedSnapshot])
          .mockResolvedValueOnce([parkedSnapshot]),
      },
      moderation_queue_items: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const repository = new IntegrityAuditRepository(prisma as any);

    const result = await repository.listCandidates({
      serverId: 'guild-1',
      since: new Date('2026-08-01T00:00:00.000Z'),
      limit: 1,
    });

    expect(prisma.role_quarantine_snapshots.findMany).toHaveBeenNthCalledWith(2, {
      where: {
        verification_event_id: { in: [parkedCase.id] },
        status: RoleQuarantineSnapshotStatus.ACTIVE,
      },
    });
    expect(result.activeRoleQuarantineSnapshots).toEqual([unrelatedSnapshot, parkedSnapshot]);
  });
});
