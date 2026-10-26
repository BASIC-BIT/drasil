import { mockDeep } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '../../db/prisma';
import {
  VerificationEventRepository,
  VerificationCaseAdmissionSupersededError,
} from '../../repositories/VerificationEventRepository';
import { VerificationStatus } from '../../repositories/types';

function fixture(metadata: Prisma.JsonObject) {
  const transaction = mockDeep<Prisma.TransactionClient>();
  const prisma = mockDeep<PrismaClient>();
  jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => callback(transaction));
  transaction.$queryRaw.mockResolvedValue([{ metadata }]);
  transaction.verification_events.create.mockResolvedValue(
    mockDeep<Awaited<ReturnType<typeof transaction.verification_events.create>>>({ id: 'new-case' })
  );
  const repository = new VerificationEventRepository(prisma);
  const create = () =>
    repository.createFromDetection(null, 'guild', 'target', VerificationStatus.PENDING, {
      user_snapshot: { joined_at: '2026-01-01T00:00:00Z' },
    });
  return { transaction, create };
}

describe('case admission report-ban fences', () => {
  it.each([{ report_ban_retry_count: 'bad' }, { report_ban_cases: [{ id: 42 }] }])(
    'admits a case despite unrelated malformed historical state: %p',
    async (metadata) => {
      const f = fixture(metadata);
      await expect(f.create()).resolves.toMatchObject({ id: 'new-case' });
      expect(f.transaction.verification_events.create).toHaveBeenCalledTimes(1);
    }
  );

  it('retains a valid confirmation fence despite unrelated malformed state', async () => {
    const f = fixture({
      report_ban_retry_count: 'bad',
      report_ban_cases: [{ id: 42 }],
      report_ban_confirmed_at: '2999-01-01T00:00:00Z',
      report_ban_membership_joined_at: '2026-01-01T00:00:00Z',
    });
    await expect(f.create()).rejects.toBeInstanceOf(VerificationCaseAdmissionSupersededError);
    expect(f.transaction.verification_events.create).not.toHaveBeenCalled();
  });

  it.each([{ report_ban_confirmed_at: 'invalid' }, { report_ban_membership_joined_at: false }])(
    'fails closed for a malformed admission field: %p',
    async (metadata) => {
      const f = fixture(metadata);
      await expect(f.create()).rejects.toThrow();
      expect(f.transaction.verification_events.create).not.toHaveBeenCalled();
    }
  );

  it.each([
    {
      report_ban_confirmed_at: '2025-01-01T00:00:00Z',
      report_ban_membership_joined_at: '2026-01-01T00:00:00Z',
    },
    {
      report_ban_confirmed_at: '2999-01-01T00:00:00Z',
      report_ban_membership_joined_at: '2025-01-01T00:00:00Z',
    },
  ])('admits after confirmation or for a different membership: %p', async (metadata) => {
    const f = fixture(metadata);
    await expect(f.create()).resolves.toMatchObject({ id: 'new-case' });
    expect(f.transaction.verification_events.create).toHaveBeenCalledTimes(1);
  });
});
