import { describe, expect, it } from 'vitest';
import { parseReportQueueRow } from './reportQueueDataAdapter';

const baseRow = {
  id: 'report-1',
  server_id: 'guild-1',
  reporter_id: 'reporter-1',
  thread_id: 'thread-1',
  status: 'submitted' as const,
  summary: 'Reported suspicious Nitro link.',
  confirmed_target_user_id: 'user-1',
  created_at: new Date('2026-06-01T00:00:00.000Z'),
  updated_at: new Date('2026-06-02T00:00:00.000Z'),
  evidence_count: '3',
  latest_detection_id: 'det-1',
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
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ]);
  });
});
