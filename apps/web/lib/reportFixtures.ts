import type { ReportQueueItem } from '@drasil/contracts';

export const fixtureReportQueueItems: ReportQueueItem[] = [
  {
    id: 'report-1',
    guildId: 'guild-1',
    reporterId: 'reporter-100',
    targetUserId: 'user-300',
    status: 'submitted',
    summary: 'Reporter supplied screenshots of a suspicious Nitro link.',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-03T12:00:00.000Z',
    stale: true,
    staleHours: 36,
    evidenceCount: 3,
    reportThreadUrl: 'https://discord.com/channels/guild-1/report-thread-100',
    latestDetectionId: 'det-report-1',
    latestCaseId: null,
    allowedActions: [
      'open_report_thread',
      'open_case',
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ],
  },
  {
    id: 'report-2',
    guildId: 'guild-1',
    reporterId: 'reporter-200',
    targetUserId: 'user-400',
    status: 'submitted',
    summary: 'Reporter confirmed a target but no moderator decision has been recorded yet.',
    createdAt: '2026-06-05T08:00:00.000Z',
    updatedAt: '2026-06-05T10:00:00.000Z',
    stale: false,
    staleHours: 5,
    evidenceCount: 1,
    reportThreadUrl: 'https://discord.com/channels/guild-1/report-thread-200',
    latestDetectionId: 'det-report-2',
    latestCaseId: 'case-report-2',
    allowedActions: [
      'open_report_thread',
      'mark_actioned',
      'dismiss_no_action',
      'mark_false_positive',
    ],
  },
];

export function fixtureSubmittedReports(): ReportQueueItem[] {
  return fixtureReportQueueItems;
}
