import { ServerSettings } from '../repositories/types';
import { DetectionResponseMode, isDetectionResponseMode } from './detectionResponseSettings';

export const ROLE_GATE_ENABLED_SETTING_KEY = 'role_gate_enabled';
export const HONEYPOT_ROLE_ID_SETTING_KEY = 'honeypot_role_id';
export const MEMBER_ACCESS_ROLE_ID_SETTING_KEY = 'member_access_role_id';
export const HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY = 'honeypot_role_response_mode';

export const DEFAULT_ROLE_GATE_ENABLED = false;
export const DEFAULT_HONEYPOT_ROLE_RESPONSE_MODE: DetectionResponseMode = 'restrict';

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export interface RoleGateSettings {
  readonly enabled: boolean;
  readonly honeypotRoleId: string | null;
  readonly memberAccessRoleId: string | null;
  readonly honeypotResponseMode: DetectionResponseMode;
}

export function normalizeRoleGateRoleId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const id = value.trim();
  return DISCORD_ID_PATTERN.test(id) ? id : null;
}

export function getRoleGateSettings(settings: ServerSettings | undefined): RoleGateSettings {
  const responseMode = settings?.[HONEYPOT_ROLE_RESPONSE_MODE_SETTING_KEY];
  return {
    enabled: settings?.[ROLE_GATE_ENABLED_SETTING_KEY] === true,
    honeypotRoleId: normalizeRoleGateRoleId(settings?.[HONEYPOT_ROLE_ID_SETTING_KEY]),
    memberAccessRoleId: normalizeRoleGateRoleId(settings?.[MEMBER_ACCESS_ROLE_ID_SETTING_KEY]),
    honeypotResponseMode: isDetectionResponseMode(responseMode)
      ? responseMode
      : DEFAULT_HONEYPOT_ROLE_RESPONSE_MODE,
  };
}
