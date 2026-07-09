import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseHistoryView } from './CaseHistoryView';
import { fixtureResolvedCaseSummaries } from '@/lib/caseFixtures';

const meta = {
  title: 'Active Triage/Case History',
  component: CaseHistoryView,
  parameters: {
    docs: {
      description: {
        component: 'Read-only resolved case history with Discord provenance and detail links.',
      },
    },
  },
  args: {
    cases: fixtureResolvedCaseSummaries(),
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
    totalResolvedCaseCount: fixtureResolvedCaseSummaries().length,
  },
} satisfies Meta<typeof CaseHistoryView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedHistory: Story = {};

export const EmptyHistory: Story = {
  args: {
    cases: [],
    totalResolvedCaseCount: 0,
  },
};
