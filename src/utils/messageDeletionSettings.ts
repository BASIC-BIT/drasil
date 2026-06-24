import type { ServerSettings } from '../repositories/types';
import type { ReportAttachmentMetadata } from './reportAiSettings';

export const MESSAGE_DELETION_ENABLED_SETTING_KEY = 'message_deletion_enabled';
export const MESSAGE_DELETION_SOURCE_MESSAGE_ENABLED_SETTING_KEY =
  'message_deletion_source_message_enabled';
export const MESSAGE_DELETION_WATCHLIST_ENABLED_SETTING_KEY = 'message_deletion_watchlist_enabled';
export const MESSAGE_DELETION_WATCHLIST_DISABLED_DEFAULT_IDS_SETTING_KEY =
  'message_deletion_watchlist_disabled_default_ids';
export const MESSAGE_DELETION_WATCHLIST_CUSTOM_TERMS_SETTING_KEY =
  'message_deletion_watchlist_custom_terms';

export const WICKEDPROXY_WATCHLIST_ENTRY_ID = 'wickedproxy-video-link';

const URL_PATTERN = /https?:\/\/\S+|www\.\S+/i;
const VIDEO_FILENAME_PATTERN = /\.(?:mp4|mov|m4v|webm)(?:[?#].*)?$/i;
const MAX_CUSTOM_WATCHLIST_TERMS = 25;
const MAX_CUSTOM_WATCHLIST_TERM_LENGTH = 120;

export interface MessageWatchlistEntry {
  readonly id: string;
  readonly label: string;
  readonly terms: readonly string[];
  readonly requiresLinkOrVideo: boolean;
}

export interface MessageDeletionSettings {
  readonly enabled: boolean;
  readonly sourceMessageDeletionEnabled: boolean;
  readonly watchlistEnabled: boolean;
  readonly watchlistEntries: readonly MessageWatchlistEntry[];
  readonly disabledDefaultWatchlistEntryIds: readonly string[];
  readonly customWatchlistTerms: readonly string[];
}

export interface MessageWatchlistMatch {
  readonly entry: MessageWatchlistEntry;
  readonly matchedTerm: string;
}

export interface MessageWatchlistInput {
  readonly content: string;
  readonly attachments?: readonly ReportAttachmentMetadata[];
}

export const DEFAULT_MESSAGE_WATCHLIST_ENTRIES: readonly MessageWatchlistEntry[] = [
  {
    id: WICKEDPROXY_WATCHLIST_ENTRY_ID,
    label: 'WickedProxy video/link campaign',
    terms: ['wickedproxy'],
    requiresLinkOrVideo: true,
  },
];

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeTerm(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const term = value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!term || term.length > MAX_CUSTOM_WATCHLIST_TERM_LENGTH) {
    return null;
  }

  return term;
}

function readStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of value) {
    const normalized = normalizeTerm(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    values.push(normalized);
    if (values.length >= maxItems) {
      break;
    }
  }

  return values;
}

function buildCustomWatchlistEntries(terms: readonly string[]): MessageWatchlistEntry[] {
  return terms.map((term, index) => ({
    id: `custom-${index + 1}`,
    label: `Custom watchlist term: ${term}`,
    terms: [term],
    requiresLinkOrVideo: true,
  }));
}

export function getMessageDeletionSettings(
  settings: ServerSettings | undefined
): MessageDeletionSettings {
  const disabledDefaultWatchlistEntryIds = readStringArray(
    settings?.[MESSAGE_DELETION_WATCHLIST_DISABLED_DEFAULT_IDS_SETTING_KEY],
    DEFAULT_MESSAGE_WATCHLIST_ENTRIES.length
  );
  const disabledDefaults = new Set(disabledDefaultWatchlistEntryIds);
  const customWatchlistTerms = readStringArray(
    settings?.[MESSAGE_DELETION_WATCHLIST_CUSTOM_TERMS_SETTING_KEY],
    MAX_CUSTOM_WATCHLIST_TERMS
  );

  return {
    enabled: readBoolean(settings?.[MESSAGE_DELETION_ENABLED_SETTING_KEY], true),
    sourceMessageDeletionEnabled: readBoolean(
      settings?.[MESSAGE_DELETION_SOURCE_MESSAGE_ENABLED_SETTING_KEY],
      true
    ),
    watchlistEnabled: readBoolean(settings?.[MESSAGE_DELETION_WATCHLIST_ENABLED_SETTING_KEY], true),
    disabledDefaultWatchlistEntryIds,
    customWatchlistTerms,
    watchlistEntries: [
      ...DEFAULT_MESSAGE_WATCHLIST_ENTRIES.filter((entry) => !disabledDefaults.has(entry.id)),
      ...buildCustomWatchlistEntries(customWatchlistTerms),
    ],
  };
}

function hasLinkOrVideo(input: MessageWatchlistInput): boolean {
  if (URL_PATTERN.test(input.content)) {
    return true;
  }

  return (
    input.attachments?.some((attachment) => {
      const contentType = attachment.contentType?.toLowerCase() ?? '';
      if (contentType.startsWith('video/')) {
        return true;
      }
      const name = attachment.name ?? attachment.url ?? '';
      return VIDEO_FILENAME_PATTERN.test(name);
    }) ?? false
  );
}

export function findMessageWatchlistMatch(
  input: MessageWatchlistInput,
  settings: MessageDeletionSettings
): MessageWatchlistMatch | null {
  if (!settings.enabled || !settings.watchlistEnabled) {
    return null;
  }

  const normalizedContent = input.content.toLowerCase();
  for (const entry of settings.watchlistEntries) {
    if (entry.requiresLinkOrVideo && !hasLinkOrVideo(input)) {
      continue;
    }

    const matchedTerm = entry.terms.find((term) => normalizedContent.includes(term));
    if (matchedTerm) {
      return { entry, matchedTerm };
    }
  }

  return null;
}
