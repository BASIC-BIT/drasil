import { ServerSettings } from '../repositories/types';

export const RESTRICTED_LOCKDOWN_ENABLED_SETTING_KEY = 'restricted_lockdown_enabled';
export const RESTRICTED_LOCKDOWN_ALLOWED_CHANNEL_IDS_SETTING_KEY =
  'restricted_lockdown_allowed_channel_ids';
export const RESTRICTED_LOCKDOWN_ALLOWED_CATEGORY_IDS_SETTING_KEY =
  'restricted_lockdown_allowed_category_ids';

export interface RestrictedLockdownSettings {
  readonly enabled: boolean;
  readonly allowedChannelIds: readonly string[];
  readonly allowedCategoryIds: readonly string[];
}

const DISCORD_ID_PATTERN = /^\d{6,}$/;

function normalizeDiscordIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const id = item.trim();
    if (!DISCORD_ID_PATTERN.test(id) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export function getRestrictedLockdownSettings(
  settings: ServerSettings | undefined
): RestrictedLockdownSettings {
  return {
    enabled: settings?.[RESTRICTED_LOCKDOWN_ENABLED_SETTING_KEY] === true,
    allowedChannelIds: normalizeDiscordIds(
      settings?.[RESTRICTED_LOCKDOWN_ALLOWED_CHANNEL_IDS_SETTING_KEY]
    ),
    allowedCategoryIds: normalizeDiscordIds(
      settings?.[RESTRICTED_LOCKDOWN_ALLOWED_CATEGORY_IDS_SETTING_KEY]
    ),
  };
}
