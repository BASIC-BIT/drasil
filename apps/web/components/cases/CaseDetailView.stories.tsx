import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseDetailView } from './CaseDetailView';
import { fixtureCaseDetails } from '@/lib/caseFixtures';

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
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    detail: fixtureCaseDetails[0],
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
