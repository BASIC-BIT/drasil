import type { ReportDetail, ReportQueueItem } from '@drasil/contracts';

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

export const fixtureReportDetails: ReportDetail[] = [
  {
    ...fixtureReportQueueItems[0],
    closedAt: null,
    evidence: [
      {
        id: 'report-evidence-1',
        kind: 'reporter_text',
        content: 'They sent me a Nitro link and asked me to sign in before it expired.',
        createdAt: '2026-06-02T12:02:00.000Z',
        sourceMessageUrl: null,
        attachment: null,
      },
      {
        id: 'report-evidence-2',
        kind: 'screenshot',
        content: null,
        createdAt: '2026-06-02T12:04:00.000Z',
        sourceMessageUrl: null,
        attachment: {
          id: 'attachment-1',
          name: 'nitro-proof.png',
          url: 'https://cdn.discordapp.com/attachments/fixture/nitro-proof.png',
          contentType: 'image/png',
          size: 184320,
        },
      },
      {
        id: 'report-evidence-3',
        kind: 'candidate_confirmation',
        content: 'Reporter confirmed user-300 as the target.',
        createdAt: '2026-06-02T12:08:00.000Z',
        sourceMessageUrl: null,
        attachment: null,
      },
    ],
  },
  {
    ...fixtureReportQueueItems[1],
    closedAt: null,
    evidence: [
      {
        id: 'report-evidence-4',
        kind: 'reported_text',
        content: 'Claim this reward before the timer runs out.',
        createdAt: '2026-06-05T08:04:00.000Z',
        sourceMessageUrl: 'https://discord.com/channels/guild-1/source-channel-1/message-400',
        attachment: null,
      },
    ],
  },
];

export function fixtureReportDetail(reportId: string): ReportDetail | null {
  return fixtureReportDetails.find((report) => report.id === reportId) ?? null;
}
