import type { Meta, StoryObj } from '@storybook/react-vite';
import { WorkflowStudy } from './WorkflowStudy';
import { workflowViews } from './workflowStudyState';

const meta = {
  title: 'Design foundation/Complete moderation workflows',
  component: WorkflowStudy,
  args: { view: 'inbox', theme: 'dark' },
  argTypes: {
    view: {
      control: { type: 'select', labels: workflowViews },
      options: Object.keys(workflowViews),
    },
  },
  parameters: { layout: 'fullscreen', a11y: { test: 'error' } },
} satisfies Meta<typeof WorkflowStudy>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MixedInbox: Story = {};
export const SubmittedReport: Story = { args: { view: 'report' } };
export const ObservedAlert: Story = { args: { view: 'alert' } };
export const PendingScreening: Story = { args: { view: 'screening' } };
export const ReporterFollowup: Story = { args: { view: 'reporter' } };
export const RecoveryReply: Story = { args: { view: 'support' } };
export const ContainmentBreach: Story = { args: { view: 'breach' } };
export const QuarantinePreview: Story = { args: { view: 'quarantine' } };
export const IncompleteContainment: Story = { args: { view: 'incomplete' } };
export const AccountRecovery: Story = { args: { view: 'recovery' } };
export const SecurityCheckPending: Story = { args: { view: 'security' } };
export const SecurityCheckPassed: Story = { args: { view: 'passed' } };
export const SecurityCheckExpired: Story = { args: { view: 'expired' } };
export const SecurityCheckDeliveryFailed: Story = { args: { view: 'delivery' } };
export const SecurityCheckBypassed: Story = { args: { view: 'bypassed' } };
export const MessageCleanup: Story = { args: { view: 'cleanup' } };
export const FrozenCleanupPreview: Story = { args: { view: 'preview' } };
export const CleanupBlocked: Story = { args: { view: 'blocked' } };
export const CleanupResults: Story = { args: { view: 'cleanupResults' } };
export const RetryCaseUpdates: Story = { args: { view: 'finalization' } };
export const ChannelConversation: Story = { args: { view: 'conversation' } };
export const ConversationUnavailable: Story = { args: { view: 'unavailable' } };
export const ActionQueued: Story = { args: { view: 'queued' } };
export const ActionProcessing: Story = { args: { view: 'processing' } };
export const ActionFailed: Story = { args: { view: 'failed' } };
export const BanUpdatesPending: Story = { args: { view: 'updates' } };
export const BanOutcomeUnknown: Story = { args: { view: 'unknown' } };
export const ResolvedByAnotherModerator: Story = { args: { view: 'resolved' } };
export const MixedInboxLight: Story = { args: { theme: 'light' } };
