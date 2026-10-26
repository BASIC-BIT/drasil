import { mockDeep } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '../../db/prisma';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { VerificationStatus } from '../../repositories/types';

function fixture(metadata: Prisma.JsonObject = {}) {
  const transaction = mockDeep<Prisma.TransactionClient>();
  const prisma = mockDeep<PrismaClient>();
  jest.spyOn(prisma, '$transaction').mockImplementation(async (callback) => callback(transaction));
  const current = mockDeep<
    NonNullable<Awaited<ReturnType<typeof transaction.verification_events.findUnique>>>
  >({
    id: 'case',
    server_id: 'guild',
    user_id: 'target',
    status: VerificationStatus.PENDING,
    created_at: new Date('2026-02-01T00:00:00Z'),
    case_revision: 2,
    quarantine_attempt_id: null,
    metadata: { user_snapshot: { joined_at: '2026-01-01T00:00:00Z' } },
  });
  const operationMetadata: Prisma.JsonObject = {
    report_ban_phase: 'enforcement_started',
    report_ban_attempt_token: 'owner',
    report_ban_membership_joined_at: '2026-01-01T00:00:00Z',
    ...metadata,
  };
  const operation = {
    id: 'operation',
    requested_at: new Date('2026-01-01T00:00:00Z'),
    metadata: operationMetadata,
    result: { observed_ban_result: { status: 'ban_outcome_unknown' } },
  };
  transaction.verification_events.findUnique.mockResolvedValue(current);
  transaction.$queryRaw.mockResolvedValueOnce([operation]).mockResolvedValueOnce([current]);
  transaction.verification_events.update.mockResolvedValue({
    ...current,
    status: VerificationStatus.BANNED,
  });
  const repository = new VerificationEventRepository(prisma);
  const observe = (status = VerificationStatus.BANNED) =>
    repository.update(
      'case',
      {
        status,
        resolved_at: new Date('2026-03-01T00:00:00Z'),
        case_revision: 2,
        metadata: { moderation_outcome_source: 'discord_gateway', audit_log_entry_id: 'audit' },
      },
      { deferReportBanEnforcement: true }
    );
  return { transaction, operation, observe };
}

describe('gateway resolution report-ban ownership', () => {
  it.each([{ report_ban_retry_count: 'bad' }, { report_ban_cases: [{ id: 42 }] }])(
    'records evidence and defers to an owner despite unrelated malformed state: %p',
    async (metadata) => {
      const f = fixture(metadata);
      await expect(f.observe()).resolves.toBeNull();
      expect(f.transaction.verification_events.update).not.toHaveBeenCalled();
      expect(f.transaction.$executeRaw).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(f.transaction.$executeRaw.mock.calls[0][1]))).toMatchObject({
        attempt_token: 'owner',
        membership_joined_at: '2026-01-01T00:00:00Z',
        case_id: 'case',
        case_revision: 2,
        source: 'discord_gateway',
        audit_log_entry_id: 'audit',
        uncertain_result: f.operation.result,
      });
    }
  );

  it('preserves opaque prior uncertainty despite malformed unused observation fields', async () => {
    const prior = { nested: ['opaque', { evidence: true }] };
    const f = fixture({
      report_ban_observed_ban: { id: 42, occurred_at: 'invalid', uncertain_result: prior },
    });
    await expect(f.observe()).resolves.toBeNull();
    expect(JSON.parse(String(f.transaction.$executeRaw.mock.calls[0][1]))).toMatchObject({
      uncertain_result: prior,
    });
    expect(f.operation.metadata.report_ban_observed_ban).toEqual({
      id: 42,
      occurred_at: 'invalid',
      uncertain_result: prior,
    });
  });

  it('only validates ownership fields when deferring a non-ban resolution', async () => {
    const f = fixture({
      report_ban_retry_count: 'bad',
      report_ban_attempt_token: 42,
      report_ban_observed_ban: false,
    });
    await expect(f.observe(VerificationStatus.VERIFIED)).resolves.toBeNull();
    expect(f.transaction.$executeRaw).not.toHaveBeenCalled();
    expect(f.transaction.verification_events.update).not.toHaveBeenCalled();
  });

  it.each([
    { report_ban_confirmed_at: 'invalid' },
    { report_ban_membership_joined_at: false },
    { report_ban_attempt_token: 42 },
    { report_ban_observed_ban: false },
  ])('fails closed on malformed relevant safety fields: %p', async (metadata) => {
    const f = fixture(metadata);
    await expect(f.observe()).rejects.toThrow();
    expect(f.transaction.$executeRaw).not.toHaveBeenCalled();
    expect(f.transaction.verification_events.update).not.toHaveBeenCalled();
  });

  it.each([
    { report_ban_phase: 'preparing' },
    { report_ban_membership_joined_at: '2025-01-01T00:00:00Z' },
    { report_ban_confirmed_at: '2026-01-01T00:00:00Z' },
  ])('resolves a case outside active ownership: %p', async (metadata) => {
    const f = fixture(metadata);
    await expect(f.observe()).resolves.toMatchObject({
      id: 'case',
      status: VerificationStatus.BANNED,
    });
    expect(f.transaction.$executeRaw).not.toHaveBeenCalled();
    expect(f.transaction.verification_events.update).toHaveBeenCalledTimes(1);
  });
});
