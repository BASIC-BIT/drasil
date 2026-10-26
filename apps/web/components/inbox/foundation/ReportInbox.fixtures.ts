import type { ReportDetail } from '@drasil/contracts';
import { fixtureReportDetails } from '@/lib/reportFixtures';
import { fixtureMemberProfile } from '@/lib/memberProfileFixtures';

export const everydayMemberProfiles = [fixtureMemberProfile('guild-1', 'user-500')].filter(
  (profile) => profile !== null
);

const [first, second] = fixtureReportDetails;

export const everydayReports: readonly ReportDetail[] = [
  {
    ...first,
    targetDisplayName: 'riverstone',
    summary: 'Expiring Nitro link',
    allowedActions: ['open_case', 'dismiss_no_action', 'mark_false_positive'],
  },
  {
    ...second,
    targetDisplayName: 'daybreak',
    summary: 'Timed reward promotion',
    allowedActions: ['dismiss_no_action', 'mark_false_positive', 'mark_actioned'],
  },
  {
    ...first,
    id: 'report-3',
    targetUserId: 'user-500',
    targetDisplayName: 'juniper',
    reporterId: 'reporter-300',
    summary: 'Repeated links in #general',
    createdAt: '2026-06-05T10:02:00.000Z',
    updatedAt: '2026-06-05T10:05:00.000Z',
    latestDetectionId: 'det-report-3',
    reportThreadUrl: null,
    allowedActions: ['open_case', 'dismiss_no_action', 'mark_false_positive'],
    evidence: [
      {
        id: 'report-evidence-5',
        kind: 'reporter_text',
        content: 'The same link was posted repeatedly in #general.',
        createdAt: '2026-06-05T10:02:00.000Z',
        sourceMessageUrl: null,
        attachment: null,
      },
    ],
  },
];
