import { describe, expect, it, vi } from 'vitest';
import { FixtureReportIntakePortalDataAdapter } from '../e2e/legacy/reportIntakePortalDataAdapter';
import {
  parseOpenReportIntakeRow,
  PostgresReportIntakePortalDataAdapter,
} from './reportIntakePortalDataAdapter';

describe('reportIntakePortalDataAdapter', () => {
  it('parses open report intake rows with Discord thread links', () => {
    expect(
      parseOpenReportIntakeRow({
        created_at: new Date('2026-06-08T01:16:02.000Z'),
        id: '00000000-0000-4000-8000-000000000001',
        server_id: 'guild-1',
        status: 'needs_reporter_confirmation',
        thread_id: 'thread-1',
        updated_at: '2026-06-08T01:17:02.000Z',
      })
    ).toEqual({
      identityReview: null,
      statusLabel: 'needs reporter confirmation',
      createdAt: '2026-06-08T01:16:02.000Z',
      guildId: 'guild-1',
      id: '00000000-0000-4000-8000-000000000001',
      status: 'needs_reporter_confirmation',
      threadId: 'thread-1',
      threadUrl: 'https://discord.com/channels/guild-1/thread-1',
      updatedAt: '2026-06-08T01:17:02.000Z',
    });
  });

  it('exposes a fixture open intake for the signed-in fixture reporter', async () => {
    const adapter = new FixtureReportIntakePortalDataAdapter();

    await expect(
      adapter.getOpenIntakeForReporter({
        guildId: 'guild-1',
        reporterId: 'fixture-admin',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        guildId: 'guild-1',
        status: 'collecting_evidence',
        threadUrl: 'https://discord.com/channels/guild-1/report-thread-1',
      })
    );
    await expect(
      adapter.getOpenIntakeForReporter({
        guildId: 'guild-1',
        reporterId: 'other-user',
      })
    ).resolves.toBeNull();
  });
});

it('returns only the reporter status and receipt with unknown notification delivery', () => {
  const view = parseOpenReportIntakeRow({
    id: 'intake',
    server_id: 'guild',
    status: 'needs_admin_confirmation',
    thread_id: null,
    created_at: null,
    updated_at: null,
    metadata: {
      analysis: {
        schemaVersion: 1,
        sources: {},
        requestReservations: [],
        outcome: null,
        coverage: null,
        handoff: {
          state: 'pending',
          reason: 'provider_failure',
          receipt: 'sent',
          attempts: 0,
          nextDueAt: '2026-11-03T00:00:00.000Z',
        },
      },
      quarantined_metadata: { private: 'RAW' },
    },
  });
  expect(view).toMatchObject({
    statusLabel: 'Needs admin review',
    identityReview: { phase: 'pending', receipt: 'sent', delivery: 'pending' },
  });
  expect(JSON.stringify(view)).not.toMatch(/provider_failure|candidates|RAW/);
});

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => db }));
it('limits active reporter collection discovery to contexts whose intake and thread remain open', async () => {
  db.query.mockResolvedValueOnce({ rows: [] });
  const result = await new PostgresReportIntakePortalDataAdapter().getOpenIntakeForReporter({
    guildId: 'guild-1',
    reporterId: 'reporter-1',
  });
  expect(result).toBeNull();
  const [sql, values] = db.query.mock.calls[0];
  expect(values).toEqual(['guild-1', 'reporter-1']);
  expect(sql).toMatch(/and closed_at is null/i);
  expect(sql).toMatch(/and metadata\s*->>\s*'thread_closed_at' is null/i);
  expect(sql).toContain("'needs_admin_confirmation'");
});
