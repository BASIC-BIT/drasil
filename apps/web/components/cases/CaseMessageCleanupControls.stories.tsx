import type { Meta, StoryObj } from '@storybook/react-vite';
import { completedInboxActionState } from '@/lib/inboxActionState';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from '@/lib/messageCleanupFixtures';
import { MessageCleanupPanel } from './MessageCleanupPanel';

const noopAction = async () => completedInboxActionState('Fixture request queued.');
const workspace = fixtureMessageCleanupCaseWorkspaces[0];

const meta = {
  title: 'Active Triage/Message Cleanup Controls',
  component: MessageCleanupPanel,
  args: {
    integration: {
      workspace: { ...workspace, latestJobs: [] },
      deleteOnlyJob: null,
      combinedJob: null,
      previewAction: noopAction,
      executeAction: noopAction,
      combinedBanAction: noopAction,
      loadedAt: '2026-10-25T12:00:00Z',
      requests: [],
      returnHref: '/admin/guild/guild-1/inbox',
    },
    policy: {
      allowedActions: ['ban_user'],
      canManageCleanup: true,
      canQueueCaseActions: true,
      canOpenReportCases: false,
      kickReasonRequired: true,
      banReasonRequired: true,
    },
  },
  decorators: [
    (Story) => (
      <section className="panel stack" style={{ maxWidth: 980 }}>
        <Story />
      </section>
    ),
  ],
} satisfies Meta<typeof MessageCleanupPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewPreview: Story = {};

export const ReadySourceMessage: Story = {
  args: {
    integration: {
      ...meta.args.integration,
      workspace,
      deleteOnlyJob: fixtureMessageCleanupJobDetails[0],
    },
  },
};
export const CombinedPartialOutcome: Story = {
  args: {
    integration: {
      ...meta.args.integration,
      workspace,
      combinedJob: fixtureMessageCleanupJobDetails[1],
    },
  },
};
export const BlockedCase: Story = {
  args: {
    integration: {
      ...meta.args.integration,
      workspace: {
        ...workspace,
        canPreview: false,
        blockedReason: 'case_not_pending',
        caseStatus: 'banned',
        latestJobs: [],
      },
    },
  },
};
