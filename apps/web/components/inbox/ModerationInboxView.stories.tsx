import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModerationInboxView } from './ModerationInboxView';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
import { completedInboxActionState } from '@/lib/inboxActionState';

const noopInboxAction = async () => completedInboxActionState('Fixture action completed.');
const noopCaseAction = async () => undefined;

const meta = {
  title: 'Active Triage/Moderation Inbox',
  component: ModerationInboxView,
  parameters: {
    docs: {
      description: {
        component:
          'Unified moderation inbox for cases, submitted reports, observed alerts, and queue attention.',
      },
    },
  },
  args: {
    acknowledgeQueueItemAction: noopInboxAction,
    acknowledgeQueueItemsAction: noopInboxAction,
    canOpenReportCases: true,
    canQueueCaseActions: true,
    closeReportAction: noopInboxAction,
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
    items: fixtureModerationInboxItems(),
    openReportCaseAction: noopInboxAction,
    pollActionRequests: false,
    queueCaseAction: noopCaseAction,
    queueInboxCaseAction: noopInboxAction,
    queueObservedAlertAction: noopInboxAction,
    recentActionRequests: [],
  },
} satisfies Meta<typeof ModerationInboxView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MixedInbox: Story = {};

export const EmptyInbox: Story = {
  args: {
    items: [],
  },
};
