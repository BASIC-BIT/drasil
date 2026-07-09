import type { Meta, StoryObj } from '@storybook/react-vite';
import { ModerationInboxView } from './ModerationInboxView';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';

const noopAcknowledgeQueueItemAction = async () => undefined;
const noopQueueObservedAlertAction = async () => undefined;

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
    acknowledgeQueueItemAction: noopAcknowledgeQueueItemAction,
    acknowledgeQueueItemsAction: noopAcknowledgeQueueItemAction,
    guildId: 'guild-1',
    guildName: 'Fixture Guild',
    sessionUsername: 'Fixture Admin',
    items: fixtureModerationInboxItems(),
    queueObservedAlertAction: noopQueueObservedAlertAction,
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
