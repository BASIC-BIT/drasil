import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseDetailView } from './CaseDetailView';
import { fixtureCaseDetails, fixtureResolvedCaseDetails } from '@/lib/caseFixtures';

const noopQueueCaseAction = async () => undefined;

const meta = {
  title: 'Active Triage/Case Detail',
  component: CaseDetailView,
  parameters: {
    docs: {
      description: {
        component:
          'Case detail view with Discord surface links, detection history, and persisted moderation outcomes.',
      },
    },
  },
  args: {
    canQueueCaseActions: true,
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
    detail: fixtureCaseDetails[0],
    queueCaseAction: noopQueueCaseAction,
  },
} satisfies Meta<typeof CaseDetailView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const StaleRestrictedCase: Story = {};

export const LeftUserCase: Story = {
  args: {
    detail: fixtureCaseDetails[1],
  },
};

export const BannedUserCase: Story = {
  args: {
    detail: fixtureCaseDetails[2],
  },
};

export const ResolvedReopenCase: Story = {
  args: {
    detail: fixtureResolvedCaseDetails[1],
  },
};
