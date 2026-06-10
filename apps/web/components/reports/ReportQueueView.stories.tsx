import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReportQueueView } from './ReportQueueView';
import { fixtureSubmittedReports } from '@/lib/reportFixtures';

const noopCloseReportAction = async (): Promise<void> => {};

const meta = {
  title: 'Submitted Reports/Report Queue',
  component: ReportQueueView,
  parameters: {
    docs: {
      description: {
        component:
          'Submitted report queue kept separate from active verification cases and observed alerts.',
      },
    },
  },
  args: {
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    closedReportCount: 4,
    sessionUsername: 'Fixture Admin',
    reports: fixtureSubmittedReports(),
    closeReportAction: noopCloseReportAction,
  },
} satisfies Meta<typeof ReportQueueView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedReports: Story = {};

export const EmptyReports: Story = {
  args: {
    reports: [],
  },
};
