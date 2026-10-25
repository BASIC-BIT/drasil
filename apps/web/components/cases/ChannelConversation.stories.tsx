import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { ChannelConversation } from './ChannelConversation';
import type { ConversationSource, ConversationReadResult } from '@/lib/conversationTypes';
import type { CaseDiscordMessage } from '@/lib/caseDiscordContent';
import { Foundation } from '@/components/workspace/Foundation';
import { TimestampClock } from '@/components/workspace/Timestamp';
const guildId = '100000000000000001',
  channelId = '100000000000000002';
const messageId = (n: number) => String(100000000000000000n + BigInt(n));
const source: ConversationSource = {
  guildId,
  channelId,
  messageId: messageId(125),
  recordKind: 'case',
  recordId: 'case-1',
  sourceKey: 'source_message',
  url: `https://discord.com/channels/${guildId}/${channelId}/${messageId(125)}`,
};
function message(n: number): CaseDiscordMessage {
  return {
    id: messageId(n),
    channelId,
    authorLabel: 'Actual author (100000000000000009)',
    content:
      n === 125 ? 'Current source text' : `Channel message ${n}: complete conversation text.`,
    timestamp: new Date(Date.UTC(2026, 9, 25, 12, n)).toISOString(),
    url: `https://discord.com/channels/${guildId}/${channelId}/${messageId(n)}`,
    attachments:
      n === 125
        ? [
            {
              id: 'attachment',
              filename: 'proof.png',
              contentType: 'image/png',
              url: 'https://cdn.discordapp.com/attachments/example/proof.png',
            },
          ]
        : [],
  };
}
function Scenario({ scenario = 'available' }: { scenario?: 'available' | 'deleted' | 'denied' }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <TimestampClock>
      <main style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
        <h1>Saved source</h1>
        <blockquote>Complete saved quotation</blockquote>
        <button ref={trigger} type="button" onClick={() => setOpen(true)}>
          View conversation
        </button>
        {open ? (
          <ChannelConversation
            source={source}
            onBackToSource={() => {
              setOpen(false);
              trigger.current?.focus();
            }}
            loadPage={async (_guildId, query): Promise<ConversationReadResult> => {
              if (scenario === 'denied') return { kind: 'unavailable', reason: 'denied' };
              const cursor =
                query.page.kind === 'around'
                  ? 100
                  : Number(BigInt(query.page.cursor) - 100000000000000000n) +
                    (query.page.kind === 'before' ? -50 : 1);
              const messages = Array.from({ length: 50 }, (_, index) =>
                message(cursor + index)
              ).filter((item) => scenario !== 'deleted' || item.id !== source.messageId);
              if (scenario === 'deleted' && messages.length === 49)
                messages.push(message(cursor + 50));
              return {
                kind: 'available',
                source,
                messages,
                channelLabel: 'general',
                fetchedAt: '2026-10-25T15:00:00.000Z',
                earlier: true,
                later: true,
                sourcePresent: scenario !== 'deleted',
              };
            }}
          />
        ) : null}
      </main>
    </TimestampClock>
  );
}
const meta = {
  title: 'Workspace/Channel Conversation',
  component: Scenario,
  decorators: [
    (Story) => (
      <Foundation theme="light">
        <Story />
      </Foundation>
    ),
  ],
} satisfies Meta<typeof Scenario>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Available: Story = { args: { scenario: 'available' } };
export const DeletedSource: Story = { args: { scenario: 'deleted' } };
export const DeniedChannel: Story = { args: { scenario: 'denied' } };
