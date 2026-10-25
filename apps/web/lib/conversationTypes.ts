import { z } from 'zod';
import type { CaseDetail, ReportDetail } from '@drasil/contracts';
import type { CaseDiscordMessage } from './caseDiscordContent';
export const caseDiscordMessageSchema: z.ZodType<CaseDiscordMessage> = z.object({
  id: z.string(),
  channelId: z.string(),
  authorLabel: z.string(),
  content: z.string(),
  timestamp: z.string(),
  url: z.string().url(),
  attachments: z.array(
    z.object({
      id: z.string(),
      filename: z.string().nullable(),
      url: z.string().url().nullable(),
      contentType: z.string().nullable(),
    })
  ),
});

const snowflake = z.string().regex(/^\d{17,20}$/);
export const conversationQuerySchema = z
  .object({
    recordKind: z.enum(['case', 'report']),
    recordId: z.string().min(1).max(200),
    sourceKey: z.string().min(1).max(220),
    page: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('around') }).strict(),
      z.object({ kind: z.enum(['before', 'after']), cursor: snowflake }).strict(),
    ]),
  })
  .strict();
export type ConversationQuery = z.infer<typeof conversationQuerySchema>;
export const conversationSourceSchema = z.object({
  recordKind: z.enum(['case', 'report']),
  recordId: z.string(),
  sourceKey: z.string(),
  guildId: snowflake,
  channelId: snowflake,
  messageId: snowflake,
  url: z.string().url(),
});
export type ConversationSource = z.infer<typeof conversationSourceSchema>;
export const conversationReadResultSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('available'),
    messages: z.array(caseDiscordMessageSchema).max(50),
    source: conversationSourceSchema,
    channelLabel: z.string().nullable(),
    fetchedAt: z.string().datetime(),
    earlier: z.boolean(),
    later: z.boolean(),
    sourcePresent: z.boolean(),
  }),
  z.object({ kind: z.literal('unavailable'), reason: z.enum(['denied', 'missing', 'upstream']) }),
]);
export type ConversationReadResult = z.infer<typeof conversationReadResultSchema>;
/** Only canonical saved references can identify a Discord message. */
export function parseConversationReference(
  url: string,
  guildId: string
): { channelId: string; messageId: string } | null {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'discord.com' ||
      parsed.port ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      return null;
    const match = /^\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})$/.exec(parsed.pathname);
    return match?.[1] === guildId ? { channelId: match[2], messageId: match[3] } : null;
  } catch {
    return null;
  }
}

function sourceDescriptor(
  recordKind: 'case' | 'report',
  recordId: string,
  guildId: string,
  sourceKey: string,
  url: string | null
): ConversationSource[] {
  const identity = url ? parseConversationReference(url, guildId) : null;
  return identity && url ? [{ recordKind, recordId, guildId, sourceKey, url, ...identity }] : [];
}
export function caseConversationSources(detail: CaseDetail): ConversationSource[] {
  return [
    ...sourceDescriptor(
      'case',
      detail.id,
      detail.guildId,
      'source_message',
      detail.surfaces.find((surface) => surface.kind === 'source_message')?.url ?? null
    ),
    ...detail.evidenceItems.flatMap((item) =>
      sourceDescriptor('case', detail.id, detail.guildId, `evidence:${item.id}`, item.url)
    ),
  ];
}
export function reportConversationSources(report: ReportDetail): ConversationSource[] {
  return report.evidence.flatMap((item) =>
    sourceDescriptor(
      'report',
      report.id,
      report.guildId,
      `evidence:${item.id}`,
      item.sourceMessageUrl
    )
  );
}
