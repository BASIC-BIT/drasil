import type { Meta, StoryObj } from '@storybook/react-vite';
import { CaseWorkspace } from './CaseWorkspace';
import { everydayCase, everydayCaseMember, openedReport, busyCase } from './CaseWorkspace.fixtures';
import type { CaseDecisionHandler } from './caseReview';

const simulateRequest: CaseDecisionHandler = async (_caseId, action) => ({
  status: 'queued',
  requestId: `request-${action}`,
  message: 'Waiting for Drasil to execute the request.',
});
const meta = {
  title: 'Design foundation/Case workspace',
  component: CaseWorkspace,
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
  argTypes: {
    onAction: { control: false },
    detail: { control: false },
    report: { control: false },
    profile: { control: false },
  },
  args: {
    detail: everydayCase,
    guildName: 'Community',
    profile: everydayCaseMember,
    report: openedReport,
    theme: 'dark',
    onAction: simulateRequest,
  },
} satisfies Meta<typeof CaseWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EverydayCase: Story = {};
export const BusyCase: Story = {
  args: { detail: busyCase, profile: undefined, report: undefined },
};
export const Light: Story = { args: { theme: 'light' } };
export const CompletedRequest: Story = {
  args: {
    onAction: async () => ({ status: 'completed', requestId: 'request-completed', message: null }),
  },
};
export const DelayedRequest: Story = {
  args: {
    onAction: async (...args) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 1800));
      return simulateRequest(...args);
    },
  },
};
export const FailedRequest: Story = {
  args: {
    onAction: async () => ({
      status: 'failed',
      requestId: 'request-failed',
      message: 'The request could not be completed. Check the case before trying again.',
    }),
  },
};
