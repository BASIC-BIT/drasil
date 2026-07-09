import { describe, expect, it, vi } from 'vitest';
import { PostgresReportQueueDataAdapter, parseReportQueueRow } from './reportQueueDataAdapter';

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

  it('routes submitted report closures through the shared review service', async () => {
    const closeSubmittedReport = vi.fn(async () => ({
      actor: { id: 'admin-1', surface: 'web' as const },
      action: 'mark_false_positive' as const,
      reportId: 'report-1',
      reportStatus: 'false_positive' as const,
      status: 'closed' as const,
      queueCleanupStatus: 'skipped' as const,
    }));
    const adapter = new PostgresReportQueueDataAdapter({
      canOpenSubmittedReportCase: () => false,
      closeSubmittedReport,
      openCaseFromSubmittedReport: vi.fn(),
    });

    await expect(
      adapter.closeSubmittedReport({
        guildId: 'guild-1',
        reportId: 'report-1',
        action: 'mark_false_positive',
        adminId: 'admin-1',
      })
    ).resolves.toBe(true);

    expect(closeSubmittedReport).toHaveBeenCalledWith({
      actor: { id: 'admin-1', surface: 'web' },
      action: 'mark_false_positive',
      reportId: 'report-1',
      serverId: 'guild-1',
    });
  });

  it('routes submitted report case open through the shared review service', async () => {
    const openCaseFromSubmittedReport = vi.fn(async () => ({
      actor: { id: 'admin-1', surface: 'web' as const },
      action: 'open_case' as const,
      caseId: 'case-1',
      detectionEventId: 'det-1',
      reportId: 'report-1',
      status: 'opened' as const,
      targetUserId: 'user-1',
      queueCleanupStatus: 'skipped' as const,
    }));
    const adapter = new PostgresReportQueueDataAdapter({
      canOpenSubmittedReportCase: () => true,
      closeSubmittedReport: vi.fn(),
      openCaseFromSubmittedReport,
    });

    await expect(
      adapter.openCaseFromSubmittedReport({
        guildId: 'guild-1',
        reportId: 'report-1',
        adminId: 'admin-1',
      })
    ).resolves.toMatchObject({
      caseId: 'case-1',
      status: 'opened',
    });

    expect(adapter.canOpenSubmittedReportCase()).toBe(true);
    expect(openCaseFromSubmittedReport).toHaveBeenCalledWith({
      actor: { id: 'admin-1', surface: 'web' },
      reportId: 'report-1',
      serverId: 'guild-1',
    });
  });
});
