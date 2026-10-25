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

function SourceReplacement({
  change,
  pending,
}: {
  change: 'channel' | 'message';
  pending: boolean;
}) {
  const [replaced, setReplaced] = useState(false);
  const [aborted, setAborted] = useState(false);
  const [released, setReleased] = useState(false);
  const [lastPage, setLastPage] = useState('');
  const release = useRef<(() => void) | null>(null);
  const selected = replaced
    ? {
        ...source,
        channelId: change === 'channel' ? '100000000000000003' : source.channelId,
        messageId: change === 'message' ? messageId(126) : source.messageId,
      }
    : source;
  const selectedSource = {
    ...selected,
    url: `https://discord.com/channels/${guildId}/${selected.channelId}/${selected.messageId}`,
  };
  return (
    <main style={{ maxWidth: 1000, margin: 'auto', padding: 16 }}>
      <button type="button" onClick={() => setReplaced(true)}>
        Replace resolved source
      </button>
      <button
        type="button"
        onClick={() => {
          release.current?.();
          setReleased(true);
        }}
      >
        Release old response
      </button>
      <p>Old request aborted: {String(aborted)}</p>
      <p>Old response released: {String(released)}</p>
      <p>Last replacement page: {lastPage}</p>
      <ChannelConversation
        source={selectedSource}
        onBackToSource={() => undefined}
        loadPage={async (_guildId, query, signal) => {
          if (!replaced && pending) {
            signal.addEventListener('abort', () => setAborted(true), { once: true });
            // Intentionally finish despite cancellation to exercise stale-response rejection.
            await new Promise<void>((resolve) => {
              release.current = resolve;
            });
          }
          if (replaced)
            setLastPage(
              query.page.kind === 'around' ? 'around' : `${query.page.kind}:${query.page.cursor}`
            );
          const id = query.page.kind === 'around' ? selected.messageId : messageId(300);
          return {
            kind: 'available',
            source: selectedSource,
            messages: [
              {
                ...message(125),
                id,
                channelId: selected.channelId,
                content: !replaced
                  ? 'Old source text'
                  : query.page.kind === 'around'
                    ? 'Replacement source text'
                    : 'Replacement later message',
                url: `https://discord.com/channels/${guildId}/${selected.channelId}/${id}`,
                attachments: [],
              },
            ],
            channelLabel: replaced ? 'replacement' : 'original',
            fetchedAt: '2026-10-25T15:00:00.000Z',
            earlier: false,
            later: true,
            sourcePresent: query.page.kind === 'around',
          };
        }}
      />
    </main>
  );
}
export const ReplaceLoadedChannel: Story = {
  render: () => <SourceReplacement change="channel" pending={false} />,
};
export const ReplaceLoadedMessage: Story = {
  render: () => <SourceReplacement change="message" pending={false} />,
};
export const ReplacePendingChannel: Story = {
  render: () => <SourceReplacement change="channel" pending />,
};
export const ReplacePendingMessage: Story = {
  render: () => <SourceReplacement change="message" pending />,
};
