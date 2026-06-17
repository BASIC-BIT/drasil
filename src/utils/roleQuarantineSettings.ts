import { ServerSettings } from '../repositories/types';

export const ROLE_QUARANTINE_MODE_SETTING_KEY = 'role_quarantine_mode';
export const ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY = 'role_quarantine_exempt_role_ids';

export const ROLE_QUARANTINE_MODES = ['off', 'on'] as const;
export type RoleQuarantineMode = (typeof ROLE_QUARANTINE_MODES)[number];

export const DEFAULT_ROLE_QUARANTINE_MODE: RoleQuarantineMode = 'off';

export interface RoleQuarantineSettings {
  readonly mode: RoleQuarantineMode;
  readonly exemptRoleIds: readonly string[];
}

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export function isRoleQuarantineMode(value: string): value is RoleQuarantineMode {
  return ROLE_QUARANTINE_MODES.includes(value as RoleQuarantineMode);
}

export function normalizeRoleQuarantineRoleIds(value: unknown): string[] {
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

export function getRoleQuarantineSettings(
  settings: ServerSettings | undefined
): RoleQuarantineSettings {
  const modeValue = settings?.[ROLE_QUARANTINE_MODE_SETTING_KEY];
  const mode =
    typeof modeValue === 'string' && isRoleQuarantineMode(modeValue)
      ? modeValue
      : DEFAULT_ROLE_QUARANTINE_MODE;

  return {
    mode,
    exemptRoleIds: normalizeRoleQuarantineRoleIds(
      settings?.[ROLE_QUARANTINE_EXEMPT_ROLE_IDS_SETTING_KEY]
    ),
  };
}
