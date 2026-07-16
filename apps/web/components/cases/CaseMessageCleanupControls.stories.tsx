import type { Meta, StoryObj } from '@storybook/react-vite';
import { completedInboxActionState } from '@/lib/inboxActionState';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from '@/lib/messageCleanupFixtures';
import { CaseMessageCleanupControls } from './CaseMessageCleanupControls';

const noopAction = async () => completedInboxActionState('Fixture request queued.');
const workspace = fixtureMessageCleanupCaseWorkspaces[0];

const meta = {
  title: 'Active Triage/Message Cleanup Controls',
  component: CaseMessageCleanupControls,
  args: {
    executeAction: noopAction,
    jobDetail: null,
    previewAction: noopAction,
    workspace: { ...workspace, latestJobs: [] },
  },
  decorators: [
    (Story) => (
      <section className="panel stack" style={{ maxWidth: 980 }}>
        <Story />
      </section>
    ),
  ],
} satisfies Meta<typeof CaseMessageCleanupControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewPreview: Story = {};

export const ReadySourceMessage: Story = {
  args: {
    jobDetail: fixtureMessageCleanupJobDetails[0],
    workspace,
  },
};

export const CombinedPartialOutcome: Story = {
  args: {
    jobDetail: fixtureMessageCleanupJobDetails[1],
    mode: 'ban_with_cleanup',
    workspace,
  },
};

export const BlockedCase: Story = {
  args: {
    workspace: {
      ...workspace,
      canPreview: false,
      blockedReason: 'case_not_pending',
      caseStatus: 'banned',
      latestJobs: [],
    },
  },
};
