import type { CaseDetail, CaseSurfaceKind, CaseSurfaceLink } from '@drasil/contracts';
import {
  fetchBotChannelMessages,
  fetchBotMessage,
  type DiscordMessage,
  type DiscordMessageAttachment,
} from './discordApi';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';

const THREAD_MESSAGE_LIMIT = 200;
const threadSurfaceKinds = new Set<CaseSurfaceKind>([
  'admin_evidence_thread',
  'verification_thread',
  'report_intake_thread',
]);

export interface CaseDiscordAttachment {
  readonly id: string;
  readonly filename: string | null;
  readonly url: string | null;
  readonly contentType: string | null;
}

export interface CaseDiscordMessage {
  readonly id: string;
  readonly channelId: string;
  readonly authorLabel: string;
  readonly content: string;
  readonly timestamp: string;
  readonly url: string;
  readonly attachments: readonly CaseDiscordAttachment[];
}

export interface CaseDiscordThreadSnapshot {
  readonly kind: CaseSurfaceKind;
  readonly label: string;
  readonly channelId: string;
  readonly url: string;
  readonly messages: readonly CaseDiscordMessage[];
  readonly truncated: boolean;
  readonly error: string | null;
}

export interface CaseDiscordSnapshot {
  readonly sourceMessage: CaseDiscordMessage | null;
  readonly threads: readonly CaseDiscordThreadSnapshot[];
  readonly errors: readonly string[];
}

interface ParsedDiscordUrl {
  readonly guildId: string;
  readonly channelId: string;
  readonly messageId: string | null;
}

function parseDiscordUrl(url: string): ParsedDiscordUrl | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'channels' || !parts[1] || !parts[2]) {
      return null;
    }
    return {
      guildId: parts[1],
      channelId: parts[2],
      messageId: parts[3] ?? null,
    };
  } catch {
    return null;
  }
}

function formatAuthor(message: DiscordMessage): string {
  const displayName = message.author.global_name ?? message.author.username;
  return `${displayName} (${message.author.id})`;
}

function mapAttachment(attachment: DiscordMessageAttachment): CaseDiscordAttachment {
  return {
    id: attachment.id,
    filename: attachment.filename ?? null,
    url: attachment.url ?? attachment.proxy_url ?? null,
    contentType: attachment.content_type ?? null,
  };
}

function mapMessage(guildId: string, message: DiscordMessage): CaseDiscordMessage {
  return {
    id: message.id,
    channelId: message.channel_id,
    authorLabel: formatAuthor(message),
    content: message.content,
    timestamp: message.timestamp,
    url: discordMessageUrl(guildId, message.channel_id, message.id),
    attachments: (message.attachments ?? []).map(mapAttachment),
  };
}

function formatFetchError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown Discord API error.';
}

function uniqueErrors(errors: readonly string[]): string[] {
  return Array.from(new Set(errors));
}

function fixtureDiscordMessage(args: {
  readonly guildId: string;
  readonly channelId: string;
  readonly id: string;
  readonly authorLabel: string;
  readonly content: string;
  readonly timestamp: string;
}): CaseDiscordMessage {
  return {
    ...args,
    url: discordMessageUrl(args.guildId, args.channelId, args.id),
    attachments: [],
  };
}

function fixtureSnapshot(guildId: string, detail: CaseDetail): CaseDiscordSnapshot {
  const sourceSurface = detail.surfaces.find((surface) => surface.kind === 'source_message');
  const source = sourceSurface ? parseDiscordUrl(sourceSurface.url) : null;
  const sourceMessage = source?.messageId
    ? fixtureDiscordMessage({
        guildId,
        channelId: source.channelId,
        id: source.messageId,
        authorLabel: `${detail.userId} (${detail.userId})`,
        content:
          'free rewards for early members, claim here before it expires: https://short.example/prize',
        timestamp: detail.latestDetectionAt ?? detail.updatedAt,
      })
    : null;

  return {
    sourceMessage,
    threads: detail.surfaces
      .filter((surface) => threadSurfaceKinds.has(surface.kind))
      .map((surface) => {
        const parsed = parseDiscordUrl(surface.url);
        const channelId = parsed?.channelId ?? surface.kind;
        return {
          kind: surface.kind,
          label: surface.label,
          channelId,
          url: surface.url,
          messages: [
            fixtureDiscordMessage({
              guildId,
              channelId,
              id: `${channelId}-message-1`,
              authorLabel: 'Drasil (bot-1)',
              content: `Opened ${surface.label.toLowerCase()} for ${detail.userId}.`,
              timestamp: detail.createdAt,
            }),
            fixtureDiscordMessage({
              guildId,
              channelId,
              id: `${channelId}-message-2`,
              authorLabel: 'Fixture Admin (fixture-admin)',
              content: 'Reviewing the message context and report details before action.',
              timestamp: detail.updatedAt,
            }),
          ],
          truncated: false,
          error: null,
        };
      }),
    errors: [],
  };
}

async function fetchSourceMessage(
  guildId: string,
  surface: CaseSurfaceLink | undefined
): Promise<{ message: CaseDiscordMessage | null; error: string | null }> {
  const parsed = surface ? parseDiscordUrl(surface.url) : null;
  if (!parsed?.messageId) {
    return { message: null, error: null };
  }

  try {
    const message = await fetchBotMessage(parsed.channelId, parsed.messageId);
    return { message: mapMessage(guildId, message), error: null };
  } catch (error) {
    return { message: null, error: formatFetchError(error) };
  }
}

async function fetchThreadSnapshot(
  guildId: string,
  surface: CaseSurfaceLink
): Promise<CaseDiscordThreadSnapshot> {
  const parsed = parseDiscordUrl(surface.url);
  const channelId = parsed?.channelId ?? '';
  if (!channelId) {
    return {
      kind: surface.kind,
      label: surface.label,
      channelId,
      url: surface.url,
      messages: [],
      truncated: false,
      error: 'Discord surface URL did not include a channel ID.',
    };
  }

  try {
    const messages = await fetchBotChannelMessages(channelId, THREAD_MESSAGE_LIMIT);
    return {
      kind: surface.kind,
      label: surface.label,
      channelId,
      url: surface.url,
      messages: messages.map((message) => mapMessage(guildId, message)),
      truncated: messages.length >= THREAD_MESSAGE_LIMIT,
      error: null,
    };
  } catch (error) {
    return {
      kind: surface.kind,
      label: surface.label,
      channelId,
      url: surface.url,
      messages: [],
      truncated: false,
      error: formatFetchError(error),
    };
  }
}

export async function fetchCaseDiscordSnapshot(
  guildId: string,
  detail: CaseDetail
): Promise<CaseDiscordSnapshot> {
  if (isWebE2eFixtureMode()) {
    return fixtureSnapshot(guildId, detail);
  }

  const sourceSurface = detail.surfaces.find((surface) => surface.kind === 'source_message');
  const threadSurfaces = detail.surfaces.filter((surface) => threadSurfaceKinds.has(surface.kind));
  const [sourceResult, threads] = await Promise.all([
    fetchSourceMessage(guildId, sourceSurface),
    Promise.all(threadSurfaces.map((surface) => fetchThreadSnapshot(guildId, surface))),
  ]);

  return {
    sourceMessage: sourceResult.message,
    threads,
    errors: uniqueErrors([
      ...(sourceResult.error ? [sourceResult.error] : []),
      ...threads.flatMap((thread) => (thread.error ? [thread.error] : [])),
    ]),
  };
}
