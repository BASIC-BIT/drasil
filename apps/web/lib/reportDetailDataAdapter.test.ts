import { describe, expect, it } from 'vitest';
import { parseReportDetailRows } from './reportDetailDataAdapter';

const baseReportRow = {
  id: 'report-1',
  server_id: 'guild-1',
  reporter_id: 'reporter-1',
  thread_id: 'thread-1',
  status: 'submitted' as const,
  summary: 'Reporter supplied evidence.',
  confirmed_target_user_id: 'user-1',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  closed_at: null,
  latest_detection_id: 'det-1',
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
      reportThreadUrl: 'https://discord.com/channels/guild-1/thread-1',
      allowedActions: [
        'open_report_thread',
        'open_case',
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
