import type { Collection, Message } from 'discord.js';

export interface ReportHistoryChannel {
  messages: {
    fetch(options: { limit: number; before?: string }): Promise<Collection<string, Message>>;
  };
}

// A full bounded scan is required before retrying an uncertain accepted send.
export async function findAuthoredReportMessage(
  channel: ReportHistoryChannel,
  authorId: string,
  marker: string,
  since: Date
): Promise<Message | null> {
  let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const found = messages.find(
      (message) =>
        message.author.id === authorId &&
        message.embeds.some((embed) => embed.footer?.text === marker)
    );
    if (found) return found;
    const last = messages.last();
    if (!last || messages.size < 100 || last.createdTimestamp < since.getTime()) return null;
    before = last.id;
  }
  throw new Error('Report presentation history is incomplete');
}
