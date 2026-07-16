import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  FixtureMessageCleanupDataAdapter,
  PostgresMessageCleanupDataAdapter,
  parseMessageCleanupCaseWorkspace,
  parseMessageCleanupItemRow,
  parseMessageCleanupJobRow,
  toBoundedSafeMessageCleanupPreview,
  type MessageCleanupCaseRow,
  type MessageCleanupItemRow,
  type MessageCleanupJobRow,
  type MessageCleanupQueryClient,
} from './messageCleanupDataAdapter';

const jobRow: MessageCleanupJobRow = {
  id: 'job-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  verification_event_id: 'case-1',
  requested_by: 'admin-1',
  actor_surface: 'web_case',
  mode: 'ban_with_cleanup',
  scope: 'last_day',
  status: 'completed',
  coverage: 'ready',
  ban_status: 'succeeded',
  case_finalization_status: 'failed',
  reason: 'Remove reviewed messages and ban the case user.',
  evidence_thread_id: 'evidence-thread-1',
  requested_window_start: new Date('2026-07-14T12:00:00.000Z'),
  requested_window_end: new Date('2026-07-15T12:00:00.000Z'),
  previewed_at: new Date('2026-07-15T12:00:01.000Z'),
  started_at: new Date('2026-07-15T12:01:00.000Z'),
  completed_at: new Date('2026-07-15T12:02:00.000Z'),
  failed_at: null,
  created_at: new Date('2026-07-15T12:00:00.000Z'),
  updated_at: new Date('2026-07-15T12:02:00.000Z'),
  candidate_count: 3,
  preserved_count: 2,
  deleted_count: 1,
  already_missing_count: 0,
  changed_count: 0,
  evidence_failed_count: 0,
  delete_failed_count: 0,
  permission_denied_count: 1,
  last_error: 'Case finalization failed.',
};

const itemRow: MessageCleanupItemRow = {
  id: 'item-1',
  message_id: 'message-1',
  channel_id: 'channel-1',
  author_id: 'user-1',
  message_created_at: new Date('2026-07-15T11:30:00.000Z'),
  message_edited_at: null,
  content_preview: 'Open https://example.invalid or www.example.invalid now.',
  attachment_count: 1,
  discovery_source: 'discord_search',
  bulk_delete_eligible: true,
  evidence_status: 'preserved',
  status: 'deleted',
  evidence_message_id: 'evidence-message-1',
  attempted_at: new Date('2026-07-15T12:01:01.000Z'),
  evidence_preserved_at: new Date('2026-07-15T12:01:02.000Z'),
  deleted_at: new Date('2026-07-15T12:01:03.000Z'),
  completed_at: new Date('2026-07-15T12:01:03.000Z'),
  failure_reason: null,
};

class StubMessageCleanupDatabase implements MessageCleanupQueryClient {
  public readonly calls: Array<{ text: string; values: unknown[] }> = [];

  public constructor(private readonly responses: QueryResultRow[][]) {}

  public async query<Row extends QueryResultRow>(
    text: string,
    values: unknown[]
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    return { rows: (this.responses.shift() ?? []) as Row[] };
  }
}

describe('messageCleanupDataAdapter', () => {
  it('maps aggregate, ban, and case-finalization outcomes', () => {
    const summary = parseMessageCleanupJobRow(jobRow);

    expect(summary).toEqual(
      expect.objectContaining({
        mode: 'ban_with_cleanup',
        banStatus: 'succeeded',
        caseFinalizationStatus: 'failed',
        outcomes: expect.objectContaining({
          candidateCount: 3,
          preservedCount: 2,
          deletedCount: 1,
          permissionDeniedCount: 1,
        }),
      })
    );
    expect(summary.evidenceThreadUrl).toBe(
      'https://discord.com/channels/guild-1/evidence-thread-1'
    );
  });

  it('bounds and de-links candidate previews', () => {
    const parsed = parseMessageCleanupItemRow('guild-1', 'evidence-thread-1', {
      ...itemRow,
      content_preview: `${itemRow.content_preview}${'x'.repeat(600)}`,
    });

    expect(parsed.contentPreview.length).toBe(500);
    expect(parsed.contentPreview).toContain('https[:]//example.invalid');
    expect(parsed.contentPreview).toContain('www[.]example.invalid');
    expect(parsed.contentPreview).not.toContain('https://');
    expect(parsed.evidenceMessageUrl).toBe(
      'https://discord.com/channels/guild-1/evidence-thread-1/evidence-message-1'
    );
    expect(toBoundedSafeMessageCleanupPreview(null)).toBe('');
  });

  it('does not expose evidence links built from unsafe path identifiers', () => {
    const parsed = parseMessageCleanupItemRow('guild-1', 'evidence-thread-1', {
      ...itemRow,
      evidence_message_id: '../message-1',
    });

    expect(parsed.evidenceMessageUrl).toBeNull();
    expect(parsed.sourceMessageUrl).toBe(
      'https://discord.com/channels/guild-1/channel-1/message-1'
    );
  });

  it('blocks case workspaces without a usable private evidence thread', () => {
    const row: MessageCleanupCaseRow = {
      id: 'case-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      status: 'pending',
      private_evidence_thread_id: null,
    };

    expect(parseMessageCleanupCaseWorkspace(row, [])).toEqual(
      expect.objectContaining({
        canPreview: false,
        blockedReason: 'missing_evidence_thread',
        evidenceThreadUrl: null,
      })
    );
  });

  it('requires guild and case scope on workspace and latest-job queries', async () => {
    const caseRow: MessageCleanupCaseRow = {
      id: 'case-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      status: 'pending',
      private_evidence_thread_id: 'evidence-thread-1',
    };
    const database = new StubMessageCleanupDatabase([[caseRow], [jobRow]]);
    const adapter = new PostgresMessageCleanupDataAdapter(database);

    const workspace = await adapter.getCaseWorkspace('guild-1', 'case-1');

    expect(workspace?.latestJobs).toHaveLength(1);
    expect(database.calls).toHaveLength(2);
    expect(database.calls[0].text).toContain('server_id = $1 and id = any($2::uuid[])');
    expect(database.calls[0].values).toEqual(['guild-1', ['case-1']]);
    expect(database.calls[1].text).toContain(
      'jobs.server_id = $1 and jobs.verification_event_id = any($2::uuid[])'
    );
    expect(database.calls[1].values.slice(0, 2)).toEqual(['guild-1', ['case-1']]);
  });

  it('loads multiple case workspaces and their latest jobs in two batched queries', async () => {
    const secondCase: MessageCleanupCaseRow = {
      id: 'case-2',
      server_id: 'guild-1',
      user_id: 'user-2',
      status: 'pending',
      private_evidence_thread_id: 'evidence-thread-2',
    };
    const database = new StubMessageCleanupDatabase([
      [
        {
          id: 'case-1',
          server_id: 'guild-1',
          user_id: 'user-1',
          status: 'pending',
          private_evidence_thread_id: 'evidence-thread-1',
        } satisfies MessageCleanupCaseRow,
        secondCase,
      ],
      [jobRow, { ...jobRow, id: 'job-2', verification_event_id: 'case-2', user_id: 'user-2' }],
    ]);
    const adapter = new PostgresMessageCleanupDataAdapter(database);

    const workspaces = await adapter.listCaseWorkspaces('guild-1', ['case-2', 'case-1']);

    expect(database.calls).toHaveLength(2);
    expect(workspaces.map((workspace) => workspace.verificationEventId)).toEqual([
      'case-2',
      'case-1',
    ]);
    expect(workspaces.every((workspace) => workspace.latestJobs.length === 1)).toBe(true);
  });

  it('requires guild and case scope on both job-detail queries', async () => {
    const database = new StubMessageCleanupDatabase([[jobRow], [itemRow]]);
    const adapter = new PostgresMessageCleanupDataAdapter(database);

    const detail = await adapter.getJobDetail('guild-1', 'case-1', 'job-1');

    expect(detail?.items).toHaveLength(1);
    expect(database.calls).toHaveLength(2);
    for (const call of database.calls) {
      expect(call.text).toContain('server_id = $1');
      expect(call.text).toContain('verification_event_id = $2::uuid');
      expect(call.values).toEqual(['guild-1', 'case-1', 'job-1']);
    }
  });

  it('keeps fixture reads scoped to both guild and case', async () => {
    const adapter = new FixtureMessageCleanupDataAdapter();

    await expect(adapter.getCaseWorkspace('guild-1', 'case-stale')).resolves.not.toBeNull();
    await expect(adapter.getCaseWorkspace('guild-2', 'case-stale')).resolves.toBeNull();
    await expect(
      adapter.listCaseWorkspaces('guild-1', ['case-stale', 'another-case'])
    ).resolves.toHaveLength(1);
    await expect(
      adapter.getJobDetail('guild-1', 'another-case', 'cleanup-job-source')
    ).resolves.toBeNull();

    const combined = await adapter.getJobDetail('guild-1', 'case-stale', 'cleanup-job-combined');
    expect(combined).toEqual(
      expect.objectContaining({
        banStatus: 'succeeded',
        caseFinalizationStatus: 'failed',
        outcomes: expect.objectContaining({ permissionDeniedCount: 1 }),
      })
    );
  });
});
