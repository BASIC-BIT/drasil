import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ModerationActionRequestSummary } from '@/lib/moderationActionRequestDataAdapter';
import { initialInboxActionState } from '@/lib/inboxActionState';
import { ReportDetailView } from './ReportDetailView';
import { fixtureReportDetails } from '@/lib/reportFixtures';

const noopCloseReportAction = async () => undefined;
const noopOpenReportCaseAction = async () => undefined;

const meta = {
  title: 'Submitted Reports/Report Detail',
  component: ReportDetailView,
  parameters: {
    docs: {
      description: {
        component: 'Submitted report detail view with retained intake evidence and Discord links.',
      },
    },
  },
  args: {
    banReportAction: async () => initialInboxActionState,
    banRequiresReason: true,
    canOpenReportCases: true,
    closeReportAction: noopCloseReportAction,
    detail: fixtureReportDetails[0],
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    openReportCaseAction: noopOpenReportCaseAction,
    sessionUsername: 'Fixture Admin',
  },
} satisfies Meta<typeof ReportDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SubmittedReport: Story = {};

export const LinkedCaseReport: Story = {
  args: {
    detail: fixtureReportDetails[1],
  },
};

export const UnconfirmedTarget: Story = {
  args: {
    detail: {
      ...fixtureReportDetails[0],
      targetUserId: null,
      targetDisplayName: null,
      allowedActions: ['open_report_thread'],
    },
  },
};
export const BanPermissionDenied: Story = {
  args: { banUnavailableReason: 'Requires Ban Members permission.' },
};
const pendingBan: ModerationActionRequestSummary = {
  id: 'report-ban-1',
  actionType: 'ban_observed_detection',
  actorSurface: 'web_report',
  completedAt: null,
  detectionEventId: 'det-report-1',
  failedAt: null,
  lastError: 'Report cleanup is pending.',
  messageDeletionJobId: null,
  reportIntakeId: 'report-1',
  requestedAction: 'ban_user',
  requestedAt: '2026-10-15T00:00:00.000Z',
  resultSummary: 'Banned. Report updates are still pending.',
  status: 'failed',
  targetUserId: 'user-300',
  updatedAt: '2026-10-15T00:00:00.000Z',
  verificationEventId: null,
  observedBanResult: { status: 'banned_updates_pending', operationId: 'report-ban-1' },
};
export const BannedUpdatesPending: Story = { args: { banRequest: pendingBan } };
export const BanOutcomeUnknown: Story = {
  args: {
    banRequest: {
      ...pendingBan,
      resultSummary: 'Ban outcome needs review.',
      observedBanResult: { status: 'ban_outcome_unknown', operationId: 'report-ban-1' },
    },
  },
};
