import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseQueueView } from './CaseQueueView';
import { fixtureCaseSummaries, fixtureResolvedCaseSummaries } from '@/lib/caseFixtures';

const meta = {
  title: 'Active Triage/Case Queue',
  component: CaseQueueView,
  parameters: {
    docs: {
      description: {
        component:
          'Read-only active case queue. Discord threads/messages stay the evidence source of truth.',
      },
    },
  },
  args: {
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    resolvedCaseCount: fixtureResolvedCaseSummaries().length,
    sessionUsername: 'Fixture Admin',
    cases: fixtureCaseSummaries(),
  },
} satisfies Meta<typeof CaseQueueView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedQueue: Story = {};

export const EmptyQueue: Story = {
  args: {
    cases: [],
  },
};
