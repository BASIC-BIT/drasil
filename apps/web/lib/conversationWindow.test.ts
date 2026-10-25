import { expect, it } from 'vitest';
import { mergeConversationWindow } from './conversationWindow';
import type { CaseDiscordMessage } from './caseDiscordContent';
const messages = (start: number, count: number): CaseDiscordMessage[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(start + i),
    channelId: 'channel',
    authorLabel: 'Author',
    content: String(i),
    timestamp: new Date((start + i) * 1000).toISOString(),
    url: 'https://discord.com',
    attachments: [],
  }));
it('merges chronological pages and deduplicates the source', () => {
  const current = messages(50, 50),
    incoming = messages(1, 50);
  const result = mergeConversationWindow({ current, incoming, direction: 'before' });
  expect(result.messages).toHaveLength(99);
  expect(result.messages[0].id).toBe('1');
  expect(result.messages[98].id).toBe('99');
  const after = mergeConversationWindow({
    current: result.messages,
    incoming: messages(99, 50).reverse(),
    direction: 'after',
  });
  expect(after.messages).toHaveLength(148);
  expect(after.messages.at(-1)?.id).toBe('148');
});
it('preserves all 200 loaded messages when a 201st distinct message arrives', () => {
  const current = messages(1, 200);
  const result = mergeConversationWindow({
    current,
    incoming: messages(201, 1),
    direction: 'after',
  });
  expect(result).toEqual({ messages: current, atLimit: true });
});
it('rejects pages above 50 and bounds initial around pages', () => {
  expect(() =>
    mergeConversationWindow({ current: [], incoming: messages(1, 51), direction: 'around' })
  ).toThrow();
  expect(
    mergeConversationWindow({
      current: [],
      incoming: messages(1, 50).reverse(),
      direction: 'around',
    }).messages
  ).toEqual(messages(1, 50));
});
