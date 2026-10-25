import { createActiveCaseDataAdapter } from './activeCaseDataAdapter';
import { createReportDetailDataAdapter } from './reportDetailDataAdapter';
import { assertConversationAccess, ConversationAccessError } from './conversationAccess';
import {
  DiscordApiError,
  fetchBotChannelMessagePage,
  fetchDiscordChannel,
  fetchBotMessage,
} from './discordApi';
import { mapDiscordMessage } from './caseDiscordContent';
import {
  conversationQuerySchema,
  conversationReadResultSchema,
  parseConversationReference,
  type ConversationQuery,
  type ConversationReadResult,
  type ConversationSource,
} from './conversationTypes';
export { conversationQuerySchema, conversationReadResultSchema } from './conversationTypes';
export type {
  ConversationQuery,
  ConversationReadResult,
  ConversationSource,
} from './conversationTypes';

async function resolveSource(
  guildId: string,
  query: ConversationQuery
): Promise<ConversationSource | null> {
  let url: string | null | undefined;
  if (query.recordKind === 'case') {
    // This adapter reads stored records only; it must never load a Discord snapshot.
    const detail = await createActiveCaseDataAdapter().getCaseDetail(guildId, query.recordId);
    if (!detail || detail.guildId !== guildId || detail.id !== query.recordId) return null;
    url =
      query.sourceKey === 'source_message'
        ? detail.surfaces.find((surface) => surface.kind === 'source_message')?.url
        : detail.evidenceItems.find((item) => `evidence:${item.id}` === query.sourceKey)?.url;
  } else {
    const report = await createReportDetailDataAdapter().getReportDetail(guildId, query.recordId);
    if (!report || report.guildId !== guildId || report.id !== query.recordId) return null;
    url = report.evidence.find(
      (item) => `evidence:${item.id}` === query.sourceKey
    )?.sourceMessageUrl;
  }
  const identity = url ? parseConversationReference(url, guildId) : null;
  return identity && url
    ? {
        guildId,
        recordKind: query.recordKind,
        recordId: query.recordId,
        sourceKey: query.sourceKey,
        ...identity,
        url,
      }
    : null;
}
export async function readConversationPage({
  guildId,
  actorId,
  query: input,
}: {
  guildId: string;
  actorId: string;
  query: ConversationQuery;
}): Promise<ConversationReadResult> {
  const parsed = conversationQuerySchema.safeParse(input);
  if (!parsed.success) return { kind: 'unavailable', reason: 'missing' };
  const query = parsed.data;
  try {
    const source = await resolveSource(guildId, query);
    if (!source) return { kind: 'unavailable', reason: 'missing' };
    await assertConversationAccess({ guildId, actorId, channelId: source.channelId });
    const channel = await fetchDiscordChannel(source.channelId);
    if (channel.id !== source.channelId || channel.guild_id !== guildId)
      return { kind: 'unavailable', reason: 'denied' };
    const page =
      query.page.kind === 'around'
        ? { kind: 'around' as const, cursor: source.messageId }
        : query.page;
    const raw = await fetchBotChannelMessagePage({ channelId: source.channelId, page, limit: 50 });
    if (
      raw.length > 50 ||
      raw.some(
        (message) =>
          message.channel_id !== source.channelId ||
          !/^\d{17,20}$/.test(message.id) ||
          !Number.isFinite(Date.parse(message.timestamp))
      )
    )
      return { kind: 'unavailable', reason: 'upstream' };
    const messages = raw
      .map((message) => mapDiscordMessage(guildId, message))
      .sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id)
      );
    // A full page can have more results. Around pages may be uneven near a channel edge.
    return conversationReadResultSchema.parse({
      kind: 'available',
      messages,
      source,
      channelLabel: channel.name ?? null,
      fetchedAt: new Date().toISOString(),
      earlier: page.kind === 'after' || raw.length === 50,
      later: page.kind === 'before' || raw.length === 50,
      sourcePresent: messages.some((message) => message.id === source.messageId),
    });
  } catch (error) {
    return {
      kind: 'unavailable',
      reason:
        error instanceof ConversationAccessError
          ? error.reason
          : error instanceof DiscordApiError && error.status === 403
            ? 'denied'
            : error instanceof DiscordApiError && error.status === 404
              ? 'missing'
              : 'upstream',
    };
  }
}

/** IDs must come from a stored same-guild attention record, never request parameters. */
export async function readAttentionReply({
  guildId,
  actorId,
  channelId,
  messageId,
}: {
  guildId: string;
  actorId: string;
  channelId: string | null;
  messageId: string | null;
}): Promise<import('./moderationWorkspaceTypes').ReplyReadState> {
  const sourceUrl = channelId
    ? `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`
    : null;
  const unavailable = { kind: 'unavailable' as const, sourceUrl };
  if (
    !channelId ||
    !messageId ||
    ![guildId, actorId, channelId, messageId].every((id) => /^\d{17,20}$/.test(id))
  )
    return unavailable;
  try {
    await assertConversationAccess({ guildId, actorId, channelId });
    const raw = await fetchBotMessage(channelId, messageId);
    if (raw.channel_id !== channelId || raw.id !== messageId) return unavailable;
    return { kind: 'available', message: mapDiscordMessage(guildId, raw) };
  } catch {
    return unavailable;
  }
}
