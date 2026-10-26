import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadReportAttentionRecord, parseReportDetailRows } from './reportDetailDataAdapter';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => db }));
beforeEach(() => vi.resetAllMocks());

const baseReportRow = {
  id: 'report-1',
  server_id: 'guild-1',
  reporter_id: 'reporter-1',
  thread_id: 'thread-1',
  status: 'submitted' as const,
  summary: 'Reporter supplied evidence.',
  metadata: {},
  confirmed_target_user_id: 'user-1',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  closed_at: null,
  latest_detection_id: 'det-1',
  latest_detection_user_id: 'user-1',
  latest_detection_handled: false,
  latest_case_id: null,
};

describe('reportDetailDataAdapter', () => {
  it('parses report detail rows with evidence and attachment metadata', () => {
    const detail = parseReportDetailRows(baseReportRow, [
      {
        id: 'evidence-1',
        kind: 'reported_text',
        source_message_id: 'message-1',
        source_channel_id: 'channel-1',
        attachment_id: null,
        content: 'Suspicious reward link.',
        metadata: {},
        created_at: new Date('2026-06-01T00:01:00.000Z'),
      },
      {
        id: 'evidence-2',
        kind: 'screenshot',
        source_message_id: null,
        source_channel_id: null,
        attachment_id: 'attachment-1',
        content: null,
        metadata: {
          name: 'proof.png',
          url: 'https://cdn.discordapp.com/attachments/proof.png',
          contentType: 'image/png',
          size: 12345,
        },
        created_at: new Date('2026-06-01T00:02:00.000Z'),
      },
    ]);

    expect(detail).toMatchObject({
      id: 'report-1',
      summarySource: 'other',
      reportThreadUrl: 'https://discord.com/channels/guild-1/thread-1',
      allowedActions: [
        'open_report_thread',
        'open_case',
        'ban_user',
        'mark_actioned',
        'dismiss_no_action',
        'mark_false_positive',
      ],
      evidence: [
        {
          sourceMessageUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
        },
        {
          attachment: {
            id: 'attachment-1',
            name: 'proof.png',
            url: 'https://cdn.discordapp.com/attachments/proof.png',
          },
        },
      ],
    });
  });

  it('omits closure actions for closed report details', () => {
    const detail = parseReportDetailRows(
      {
        ...baseReportRow,
        status: 'dismissed',
        closed_at: new Date('2026-06-03T00:00:00.000Z'),
      },
      []
    );

    expect(detail.closedAt).toBe('2026-06-03T00:00:00.000Z');
    expect(detail.allowedActions).toEqual(['open_report_thread']);
  });

  it('omits open-case when submitted report detail has no linked detection', () => {
    const detail = parseReportDetailRows(
      {
        ...baseReportRow,
        latest_detection_id: null,
      },
      []
    );

    expect(detail.allowedActions).toEqual([
      'open_report_thread',
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ]);
  });
});

it.each([
  { confirmed_target_user_id: null },
  { latest_detection_id: null },
  { status: 'actioned' as const },
  { metadata: { report_ban_operation_id: 'operation-1' } },
])('withholds ban for unavailable reports: %j', (changes) => {
  expect(parseReportDetailRows({ ...baseReportRow, ...changes }, []).allowedActions).not.toContain(
    'ban_user'
  );
});

it('allows a direct ban to resolve an existing case through the same operation', () => {
  expect(
    parseReportDetailRows({ ...baseReportRow, latest_case_id: 'case-1' }, []).allowedActions
  ).toEqual(['open_report_thread', 'ban_user']);
});

it('keeps handled detection and case links while withholding another ban', () => {
  const row = { ...baseReportRow, latest_case_id: 'case-1', latest_detection_handled: true };
  const detail = parseReportDetailRows(row, []);
  expect(detail.latestDetectionId).toBe('det-1');
  expect(detail.latestCaseId).toBe('case-1');
  expect(detail.allowedActions).toEqual(['open_report_thread']);
});
it('withholds a ban when the latest linked detection belongs to a different target', () => {
  const row = { ...baseReportRow, latest_detection_user_id: 'different-user' };
  expect(parseReportDetailRows(row, []).allowedActions).not.toContain('ban_user');
});
it('preserves unknown report and evidence event dates', () => {
  expect(
    parseReportDetailRows({ ...baseReportRow, created_at: null, updated_at: null }, [
      {
        id: 'unknown',
        kind: 'reporter_text',
        source_message_id: null,
        source_channel_id: null,
        attachment_id: null,
        content: 'Complete original text',
        metadata: {},
        created_at: null,
      },
    ])
  ).toMatchObject({
    createdAt: null,
    updatedAt: null,
    evidence: [{ createdAt: null, content: 'Complete original text' }],
  });
});

it('loads the durable intake schema without attention or reviewed-status conversion', async () => {
  db.query
    .mockResolvedValueOnce({
      rows: [{ ...baseReportRow, status: 'collecting_evidence', confirmed_target_user_id: null }],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'evidence',
          kind: 'reporter_text',
          content: 'Exact evidence.\nSecond line.',
          source_channel_id: 'channel',
          source_message_id: 'message',
          attachment_id: null,
          metadata: {},
          created_at: null,
        },
      ],
    });
  expect(await loadReportAttentionRecord('guild-1', 'report-1')).toMatchObject({
    id: 'report-1',
    guildId: 'guild-1',
    status: 'collecting_evidence',
    targetUserId: null,
    allowedActions: [],
    evidence: [
      {
        content: 'Exact evidence.\nSecond line.',
        sourceMessageUrl: 'https://discord.com/channels/guild-1/channel/message',
      },
    ],
  });
  expect(db.query.mock.calls.map(([, values]) => values)).toEqual([
    ['report-1', 'guild-1', null],
    ['report-1', 'guild-1'],
  ]);
  expect(db.query.mock.calls.every(([sql]) => !sql.includes('moderation_queue_items'))).toBe(true);
});

it.each([{ server_id: 'other' }, { id: 'other' }])(
  'rejects mismatched canonical intake identity %j before reading evidence',
  async (mismatch) => {
    db.query.mockResolvedValueOnce({ rows: [{ ...baseReportRow, ...mismatch }] });
    expect(await loadReportAttentionRecord('guild-1', 'report-1')).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
  }
);
