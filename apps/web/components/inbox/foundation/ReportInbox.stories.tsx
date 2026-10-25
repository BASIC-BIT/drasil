import type { Meta, StoryObj } from '@storybook/react-vite';
import { ReportInbox } from './ReportInbox';
import { everydayReports, everydayMemberProfiles } from './ReportInbox.fixtures';
import { resultLabels, type ReportActionHandler } from './reportTriage';

const simulateReportAction: ReportActionHandler = async (_reportId, action) =>
  action === 'open_case'
    ? {
        status: 'queued',
        requestId: 'report-case-request',
        message: 'Waiting for Drasil to open the case.',
      }
    : { status: 'completed', requestId: null, message: resultLabels[action] };

const meta = {
  title: 'Design foundation/Report inbox',
  component: ReportInbox,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    docs: {
      description: {
        component:
          'Everyday report triage using the existing report contracts. Story callbacks simulate report updates; production routes are not connected.',
      },
    },
  },
  argTypes: {
    theme: { control: 'select', options: ['dark', 'light', 'system'] },
    onAction: { control: false },
    reports: { control: false },
    memberProfiles: { control: false },
  },
  args: {
    guildId: 'guild-1',
    guildName: 'Community',
    reports: everydayReports,
    memberProfiles: everydayMemberProfiles,
    onAction: simulateReportAction,
    theme: 'dark',
  },
} satisfies Meta<typeof ReportInbox>;

export default meta;
type Story = StoryObj<typeof meta>;
export const EverydayReview: Story = {};
export const Light: Story = { args: { theme: 'light' } };
