import { InboxQueue } from '@/components/inbox/InboxQueue';
import type { ActionContext } from '@drasil/application';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseInboxLocation } from './inboxLocation';
import { reportQueueItemToInboxItem } from './moderationInboxDataAdapter';
import { parseReportDetailRows } from './reportDetailDataAdapter';
import { PostgresReportQueueDataAdapter, parseReportQueueRow } from './reportQueueDataAdapter';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./setupDataAdapter', () => ({
  getPostgresPool: () => ({ query: db.query }),
  createSetupDataAdapter: () => ({
    getServer: async () => ({ settings: { case_responder_role_ids: [] } }),
  }),
}));
const discord = vi.hoisted(() => ({
  permissions: '32',
  deleteBotMessage: vi.fn(async () => undefined),
}));
vi.mock('./discordApi', () => ({
  fetchDiscordGuild: async () => ({ id: 'guild-1', owner_id: 'owner-1' }),
  fetchDiscordGuildMember: async () => ({ roles: [] }),
  fetchDiscordGuildRoles: async () => [{ id: 'guild-1', permissions: discord.permissions }],
  deleteBotMessage: discord.deleteBotMessage,
}));
const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'request-1',
  source: 'web',
  actor: { kind: 'user', userId: 'admin-1' },
};
beforeEach(() => {
  discord.permissions = '32';
});

const baseRow = {
  id: 'report-1',
  server_id: 'guild-1',
  reporter_id: 'reporter-1',
  thread_id: 'thread-1',
  status: 'submitted' as const,
  summary: 'Reported suspicious Nitro link.',
  metadata: {},
  confirmed_target_user_id: 'user-1',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  evidence_count: '3',
  latest_detection_id: 'det-1',
  latest_detection_user_id: 'user-1',
  latest_detection_handled: false,
  latest_case_id: null,
};

describe('reportQueueDataAdapter', () => {
  it('parses submitted report rows with stale state and closure actions', () => {
    const report = parseReportQueueRow(baseRow, new Date('2026-06-03T01:00:00.000Z'));

    expect(report).toEqual(
      expect.objectContaining({
        id: 'report-1',
        guildId: 'guild-1',
        reporterId: 'reporter-1',
        targetUserId: 'user-1',
        stale: true,
        staleHours: 25,
        evidenceCount: 3,
        latestDetectionId: 'det-1',
        latestCaseId: null,
        reportThreadUrl: 'https://discord.com/channels/guild-1/thread-1',
        allowedActions: [
          'open_report_thread',
          'open_case',
          'ban_user',
          'mark_actioned',
          'dismiss_no_action',
          'mark_false_positive',
        ],
      })
    );
  });

  it('omits open-case when a submitted report already has a linked case', () => {
    const report = parseReportQueueRow(
      { ...baseRow, latest_case_id: 'case-1' },
      new Date('2026-06-02T01:00:00.000Z')
    );

    expect(report.stale).toBe(false);
    expect(report.allowedActions).toEqual([
      'open_report_thread',
      'ban_user',
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ]);
  });

  it('carries explicit AI summary provenance into the report contract', () => {
    const report = parseReportQueueRow({
      ...baseRow,
      metadata: { summary_source: 'ai_report_intake_extraction' },
    });

    expect(report.summarySource).toBe('ai');
  });

  it('omits open-case when a submitted report has no linked detection', () => {
    const report = parseReportQueueRow(
      { ...baseRow, latest_detection_id: null },
      new Date('2026-06-02T01:00:00.000Z')
    );

    expect(report.allowedActions).toEqual([
      'open_report_thread',
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ]);
  });

  it('routes authenticated report closures to the shared owner with context', async () => {
    const close = vi.fn(async () => ({
      kind: 'outcome' as const,
      outcome: {
        actor: { id: 'admin-1', surface: 'web' },
        action: 'mark_false_positive' as const,
        reportId: 'report-1',
        reportStatus: 'false_positive' as const,
        status: 'closed' as const,
        queueCleanupStatus: 'skipped' as const,
      },
    }));
    const adapter = new PostgresReportQueueDataAdapter({ close, openCase: vi.fn() });
    await expect(
      adapter.closeSubmittedReport(context, { reportId: 'report-1', action: 'mark_false_positive' })
    ).resolves.toMatchObject({ status: 'closed', queueCleanupStatus: 'skipped' });
    expect(close).toHaveBeenCalledWith(context, {
      reportId: 'report-1',
      action: 'mark_false_positive',
    });
  });
  it('retains a queued case receipt from the shared owner', async () => {
    const openCase = vi.fn(async () => ({
      kind: 'outcome' as const,
      outcome: {
        actor: { id: 'admin-1', surface: 'web' },
        action: 'open_case' as const,
        reportId: 'report-1',
        status: 'queued' as const,
        requestId: 'request-1',
        caseId: null,
        detectionEventId: 'det-1',
        targetUserId: 'user-1',
        queueCleanupStatus: 'skipped' as const,
      },
    }));
    const adapter = new PostgresReportQueueDataAdapter({ close: vi.fn(), openCase });
    await expect(
      adapter.openCaseFromSubmittedReport(context, { reportId: 'report-1' })
    ).resolves.toMatchObject({ status: 'queued', requestId: 'request-1' });
    expect(openCase).toHaveBeenCalledWith(context, { reportId: 'report-1' });
    expect(adapter.canOpenSubmittedReportCase()).toBe(true);
  });
});

it('keeps a claimed report busy in the SQL close and case-open paths', async () => {
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ ...baseRow, busy: true }] })
    .mockResolvedValueOnce({ rows: [{ ...baseRow, busy: true }] });
  const adapter = new PostgresReportQueueDataAdapter();
  expect(
    await adapter.closeSubmittedReport(context, {
      reportId: 'report-1',
      action: 'dismiss_no_action',
    })
  ).toMatchObject({ status: 'busy', reportStatus: 'dismissed' });
  expect(db.query.mock.calls[0][0]).toContain(
    "coalesce(metadata->>'report_ban_operation_id', '') = ''"
  );
  expect(
    await adapter.openCaseFromSubmittedReport(context, {
      reportId: 'report-1',
    })
  ).toMatchObject({ status: 'busy' });
  expect(db.query).toHaveBeenCalledTimes(3);
});

it('suppresses competing report closure and case actions while a report ban owns the report', () => {
  expect(
    parseReportQueueRow({ ...baseRow, metadata: { report_ban_operation_id: 'operation-1' } })
      .allowedActions
  ).toEqual(['open_report_thread']);
});

function renderInboxReport(report: ReturnType<typeof parseReportQueueRow>): string {
  return renderToStaticMarkup(
    createElement(InboxQueue, {
      guildId: 'guild-1',
      items: [reportQueueItemToInboxItem(report)],
      location: parseInboxLocation(new URLSearchParams()),
      onSelect: () => undefined,
    })
  );
}

it.each([null, 'case-1'])(
  'routes an eligible queue report with linked case %s to its selected inbox record',
  async (caseId) => {
    db.query.mockReset();
    db.query.mockResolvedValueOnce({ rows: [{ ...baseRow, latest_case_id: caseId }] });
    const [report] = await new PostgresReportQueueDataAdapter().listSubmittedReports('guild-1');

    expect(report.allowedActions).toContain('ban_user');
    const markup = renderInboxReport(report);
    expect(markup).toContain('selected=report%3Areport-1');
    expect(markup).not.toContain('Confirm Ban');
    const [sql, parameters] = db.query.mock.calls[0];
    expect(parameters).toEqual(['guild-1']);
    expect(sql).toContain('de.user_id as latest_detection_user_id');
    expect(sql).toContain(
      "coalesce(de.metadata, '{}'::jsonb) ? 'observed_action' as latest_detection_handled"
    );
    expect(sql).toContain('select id, user_id, metadata, latest_verification_event_id');
    expect(sql).toContain('where server_id = ri.server_id');
    expect(sql).toContain("metadata ->> 'reportIntakeId' = ri.id::text");
    expect(sql).toContain("where ri.server_id = $1 and ri.status = 'submitted'");
  }
);

it.each([
  { metadata: { report_ban_operation_id: 'operation-1' } },
  { latest_detection_handled: true },
  { confirmed_target_user_id: null },
  { latest_detection_id: null },
  { latest_detection_user_id: null },
  { latest_detection_user_id: 'different-user' },
  { status: 'actioned' as const },
])('withholds queue Review Ban with the same detail eligibility: %j', (changes) => {
  const row = { ...baseRow, ...changes };
  const report = parseReportQueueRow(row);
  expect(report.allowedActions).not.toContain('ban_user');
  expect(parseReportDetailRows({ ...row, closed_at: null }, []).allowedActions).not.toContain(
    'ban_user'
  );
  expect(renderInboxReport(report)).not.toContain('Review Ban');
});

it('requires fresh review authority before a direct SQL closure', async () => {
  db.query.mockReset();
  discord.permissions = '0';
  const adapter = new PostgresReportQueueDataAdapter();
  await expect(
    adapter.closeSubmittedReport(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).rejects.toThrow('moderation permissions');
  expect(db.query).not.toHaveBeenCalled();
});

it.each(['queued', 'processing', 'completed'] as const)(
  'uses shared encoding and retains the persisted %s receipt',
  async (status) => {
    db.query.mockReset();
    db.query
      .mockResolvedValueOnce({ rows: [baseRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'persisted-request-1', status }] });
    const result = await new PostgresReportQueueDataAdapter().openCaseFromSubmittedReport(context, {
      reportId: 'report-1',
    });
    expect(result).toMatchObject({
      status: status === 'completed' ? 'already_handled' : 'queued',
      requestId: 'persisted-request-1',
      queueCleanupStatus: 'skipped',
    });
    expect(db.query.mock.calls[1][1]).toEqual([
      'guild-1',
      'open_case_from_observed_detection',
      'admin-1',
      'web',
      'user-1',
      'det-1',
      'report-1',
      null,
      null,
      'web:report-open-case:guild-1:report-1:det-1',
      JSON.stringify({ requested_surface: 'web', report_intake_id: 'report-1' }),
    ]);
    expect(db.query).toHaveBeenCalledTimes(2);
  }
);
it('preserves enqueue failure instead of claiming report-case success', async () => {
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce({ rows: [baseRow] })
    .mockResolvedValueOnce({ rows: [{ id: 'persisted-request-1', status: 'failed' }] });
  await expect(
    new PostgresReportQueueDataAdapter().openCaseFromSubmittedReport(context, {
      reportId: 'report-1',
    })
  ).rejects.toThrow('could not be queued');
});
it('closes directly with context provenance and clears attention without a request insert', async () => {
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce({ rows: [{ ...baseRow, status: 'false_positive' }] })
    .mockResolvedValueOnce({
      rows: [{ id: 'queue-1', queue_channel_id: 'channel-1', queue_message_id: 'message-1' }],
    });
  await expect(
    new PostgresReportQueueDataAdapter().closeSubmittedReport(context, {
      reportId: 'report-1',
      action: 'mark_false_positive',
    })
  ).resolves.toMatchObject({ status: 'closed', queueCleanupStatus: 'cleared' });
  expect(JSON.parse(db.query.mock.calls[0][1][4])).toMatchObject({
    closed_by: 'admin-1',
    closed_action: 'mark_false_positive',
    closed_surface: 'web',
  });
  expect(discord.deleteBotMessage).toHaveBeenCalledWith('channel-1', 'message-1');
  expect(db.query).toHaveBeenCalledTimes(2);
});
it('keeps missing report queue event dates unknown and fresh', () => {
  const parsed = parseReportQueueRow({
    id: 'unknown-dates',
    server_id: 'guild-1',
    reporter_id: 'reporter',
    thread_id: null,
    status: 'submitted',
    summary: null,
    confirmed_target_user_id: null,
    created_at: null,
    updated_at: null,
    evidence_count: 0,
    latest_detection_id: null,
    latest_detection_user_id: null,
    latest_detection_handled: false,
    latest_case_id: null,
  });
  expect(parsed).toMatchObject({ createdAt: null, updatedAt: null, staleHours: 0, stale: false });
});

it('preserves closed status when Discord queue notification cleanup fails', async () => {
  db.query.mockReset();
  db.query
    .mockResolvedValueOnce({ rows: [{ ...baseRow, status: 'dismissed' }] })
    .mockResolvedValueOnce({
      rows: [{ id: 'queue-1', queue_channel_id: 'channel-1', queue_message_id: 'message-1' }],
    });
  discord.deleteBotMessage.mockRejectedValueOnce(new Error('Discord unavailable'));
  const result = await new PostgresReportQueueDataAdapter().closeSubmittedReport(context, {
    reportId: 'report-1',
    action: 'dismiss_no_action',
  });
  expect(result).toMatchObject({ status: 'closed', queueCleanupStatus: 'failed' });
});
