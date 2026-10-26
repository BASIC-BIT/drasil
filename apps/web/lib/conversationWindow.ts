import type { CaseDiscordMessage } from './caseDiscordContent';
export interface ConversationWindow {
  readonly messages: readonly CaseDiscordMessage[];
  readonly atLimit: boolean;
}
export function mergeConversationWindow({
  current,
  incoming,
  direction,
}: {
  current: readonly CaseDiscordMessage[];
  incoming: readonly CaseDiscordMessage[];
  direction: 'around' | 'before' | 'after';
}): ConversationWindow {
  if (incoming.length > 50 || current.length > 200) throw new Error('Invalid conversation window.');
  const unique = new Map<string, CaseDiscordMessage>();
  for (const message of [...(direction === 'around' ? [] : current), ...incoming])
    unique.set(`${message.channelId}:${message.id}`, message);
  if (unique.size > 200) return { messages: current, atLimit: true };
  const messages = [...unique.values()].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id)
  );
  return { messages, atLimit: messages.length === 200 };
}
