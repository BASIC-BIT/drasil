import type { Meta, StoryObj } from '@storybook/react-vite';
import { fixtureMessageCleanupJobDetails } from '@/lib/messageCleanupFixtures';
import { MessageCleanupJobDetail } from './MessageCleanupJobDetail';

const meta = {
  title: 'Active Triage/Message Cleanup Job',
  component: MessageCleanupJobDetail,
  args: {
    detail: fixtureMessageCleanupJobDetails[1],
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
  },
} satisfies Meta<typeof MessageCleanupJobDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CombinedPartialOutcome: Story = {};

export const ReadySourcePreview: Story = {
  args: {
    detail: fixtureMessageCleanupJobDetails[0],
  },
};
