import { beforeEach, describe, expect, it, vi } from 'vitest';
const database = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => database }));
import { PostgresActiveCaseDataAdapter } from './activeCaseDataAdapter';
import { fixtureActiveCaseDetail, fixtureActiveCaseSummaries } from './e2eFixtures';

const previewId = '11111111-1111-4111-8111-111111111111';
function arrange() {
  const summary = fixtureActiveCaseSummaries()[0];
  const detail = fixtureActiveCaseDetail(summary.id);
  if (!detail) throw new Error('Missing case fixture');
  const adapter = new PostgresActiveCaseDataAdapter();
  vi.spyOn(adapter, 'getCaseDetail').mockResolvedValue({
    ...detail,
    allowedActions: ['quarantine_compromised_account'],
  });
  const writes: unknown[][] = [];
  database.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes('insert into moderation_action_requests')) {
      writes.push(values);
      return { rows: [{ id: 'queued-request', status: 'queued' }] };
    }
    return { rows: [{ id: previewId }] };
  });
  return { adapter, writes, detail };
}
beforeEach(() => {
  vi.restoreAllMocks();
  database.query.mockReset();
});
describe('quarantine web submission', () => {
  it.each(['preview', 'execute'] as const)(
    'writes the shipped %s request through the shared codec',
    async (phase) => {
      const { adapter, writes, detail } = arrange();
      const result = await adapter.queueCaseAction({
        action: 'quarantine_compromised_account',
        adminId: 'moderator',
        attemptId: 'attempt',
        guildId: detail.guildId,
        caseId: detail.id,
        quarantinePhase: phase,
        previewRequestId: previewId,
        reason: 'Reported compromise',
      });
      expect(result).toMatchObject({ status: 'queued', requestId: 'queued-request' });
      expect(writes).toHaveLength(1);
      expect(writes[0].slice(0, 9)).toEqual([
        detail.guildId,
        phase === 'preview' ? 'preview_account_quarantine' : 'quarantine_compromised_account',
        'moderator',
        'web',
        detail.userId,
        null,
        null,
        detail.id,
        null,
      ]);
      expect(writes[0][9]).toBe(
        `web:case-action:quarantine_compromised_account:${detail.guildId}:${detail.id}:${phase === 'preview' ? 'preview:attempt' : `execute:${previewId}`}`
      );
      expect(JSON.parse(String(writes[0][10]))).toEqual({
        case_action: 'quarantine_compromised_account',
        quarantine_phase: phase,
        requested_surface: 'web',
        ...(phase === 'execute'
          ? { reason: 'Reported compromise', preview_request_id: previewId }
          : {}),
      });
    }
  );
  it('refuses an execution whose actor/case-bound persisted preview lookup fails', async () => {
    const { adapter, writes, detail } = arrange();
    database.query.mockResolvedValueOnce({ rows: [] });
    await expect(
      adapter.queueCaseAction({
        action: 'quarantine_compromised_account',
        adminId: 'another-moderator',
        guildId: detail.guildId,
        caseId: detail.id,
        quarantinePhase: 'execute',
        previewRequestId: previewId,
        reason: 'Reported compromise',
      })
    ).resolves.toMatchObject({ status: 'not_allowed' });
    expect(writes).toEqual([]);
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('actor_id = $3'), [
      previewId,
      detail.guildId,
      'another-moderator',
      detail.userId,
      detail.id,
    ]);
  });
});
