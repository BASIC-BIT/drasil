import { beforeEach, expect, it, vi } from 'vitest';
import { createModerationAttentionDataAdapter } from './moderationAttentionDataAdapter';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => db }));
vi.mock('./reportQueueDataAdapter', () => ({
  createReportQueueDataAdapter: () => ({ canOpenSubmittedReportCase: () => true }),
}));
const actor = {
  guildId: 'guild-1',
  userId: 'admin',
  present: true,
  owner: true,
  permissions: '8',
  roleIds: [],
};
const row = {
  id: 'attention',
  server_id: 'guild-1',
  user_id: 'reporter',
  item_type: 'report_thread_attention',
  verification_event_id: null,
  detection_event_id: null,
  report_intake_id: 'intake',
  source_thread_id: 'report-thread',
  queue_channel_id: 'queue',
  queue_message_id: 'notice',
  last_source_message_id: 'reply',
  created_at: '2026-10-22T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
  metadata: { latest_message_at: '2026-10-21T14:40:00.000Z' },
  server_settings: {},
  detection_confidence: null,
  report_summary: null,
  report_metadata: {},
  user_metadata: {},
  user_username: null,
  case_kind: null,
  discord_member_pending_since: '2026-10-21T14:40:00.000Z',
  discord_member_pending_last_checked_at: null,
};
const intake = {
  id: 'intake',
  server_id: 'guild-1',
  reporter_id: 'reporter',
  status: 'collecting_evidence',
  confirmed_target_user_id: null,
  summary: null,
  metadata: {},
  thread_id: 'report-thread',
  created_at: row.created_at,
  updated_at: row.updated_at,
  closed_at: null,
  latest_detection_id: null,
  latest_case_id: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [row]
      : sql.includes('from report_intakes ri')
        ? [intake]
        : [],
  }));
});
it('reads early intake without casting it to ReportDetail and keeps the actual reply destination', async () => {
  const earlyReply = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'queue:attention',
  });
  expect(earlyReply).toMatchObject({
    kind: 'report_attention',
    intake: { status: 'collecting_evidence', targetUserId: null },
    reply: {
      kind: 'unavailable',
      sourceUrl: 'https://discord.com/channels/guild-1/report-thread/reply',
    },
  });
  expect(earlyReply?.item.allowedActions).toEqual(['acknowledge', 'open_discord']);
});
it('retains separate linkage IDs and guild-scopes all joined records and evidence', async () => {
  const detail = await createModerationAttentionDataAdapter().getAttentionDetail({
    guildId: 'guild-1',
    queueItemId: 'attention',
  });
  expect(detail).toMatchObject({
    queueType: 'report_thread_attention',
    reportId: 'intake',
    caseId: null,
    detectionId: null,
    sourceThreadId: 'report-thread',
    latestReplyMessageId: 'reply',
  });
  const [sql, values] = db.query.mock.calls[0];
  expect(values).toEqual(['guild-1', 'attention']);
  expect(sql).toContain('ve.server_id = mqi.server_id');
  expect(sql).toContain('ri.server_id = mqi.server_id');
});
it('retains a quarantine breach subtype without calling the posting location the recovery thread', async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [
          {
            ...row,
            item_type: 'quarantine_breach_attention',
            report_intake_id: null,
            source_thread_id: 'prohibited-channel',
          },
        ]
      : [],
  }));
  const breach = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'queue:attention',
  });
  expect(breach).toMatchObject({
    kind: 'support_attention',
    subtype: 'quarantine_breach',
    caseData: null,
    reply: { sourceUrl: 'https://discord.com/channels/guild-1/prohibited-channel/reply' },
  });
});
it('retains recovery replies and null reply references', async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [
          {
            ...row,
            item_type: 'support_thread_attention',
            case_kind: 'compromised_account',
            report_intake_id: null,
            source_thread_id: null,
            last_source_message_id: null,
          },
        ]
      : [],
  }));
  expect(
    await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
      guildId: 'guild-1',
      itemId: 'queue:attention',
    })
  ).toMatchObject({
    kind: 'support_attention',
    subtype: 'recovery_reply',
    reply: { kind: 'unavailable', sourceUrl: null },
  });
});
it('reads screening timestamps from member fields, leaving missing values null', async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [{ ...row, item_type: 'pending_screening_member', report_intake_id: null }]
      : [],
  }));
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'queue:attention',
  });
  expect(result).toMatchObject({
    kind: 'pending_screening',
    screening: {
      pendingSince: '2026-10-21T14:40:00.000Z',
      thresholdDays: null,
      lastCheckedAt: null,
    },
  });
});
it('returns null for absent or cross-guild attention', async () => {
  db.query.mockResolvedValue({ rows: [{ ...row, server_id: 'guild-2' }] });
  expect(
    await createModerationAttentionDataAdapter().getAttentionDetail({
      guildId: 'guild-1',
      queueItemId: 'foreign-item',
    })
  ).toBeNull();
});
it('retains ordinary support replies and does not invent an event date', async () => {
  db.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [
          {
            ...row,
            item_type: 'support_thread_attention',
            case_kind: 'standard',
            report_intake_id: null,
            metadata: {},
          },
        ]
      : [],
  }));
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'queue:attention',
  });
  expect(result).toMatchObject({
    kind: 'support_attention',
    subtype: 'support_reply',
    item: { sourceMetadata: { eventAt: null } },
  });
});
