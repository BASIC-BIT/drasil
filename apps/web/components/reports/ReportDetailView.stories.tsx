import type { Meta, StoryObj } from '@storybook/react-vite';
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
