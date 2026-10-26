const threadSurfaceKinds = new Set<CaseSurfaceKind>([
  'admin_evidence_thread',
  'verification_thread',
  'report_intake_thread',
]);
// Explicit legacy test-build boundary. Never imported by the release build.
import { discordMessageUrl } from '@/lib/discordUrls';
import type { CaseDetail, CaseSurfaceKind } from '@drasil/contracts';
import { type CaseDiscordMessage, type CaseDiscordSnapshot } from '../../lib/caseDiscordContent';
export * from '../../lib/caseDiscordContent';

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

export async function fetchCaseDiscordSnapshot(
  guildId: string,
  detail: CaseDetail
): Promise<CaseDiscordSnapshot> {
  return fixtureSnapshot(guildId, detail);
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

interface ParsedDiscordUrl {
  guildId: string;
  channelId: string;
  messageId: string | null;
}
