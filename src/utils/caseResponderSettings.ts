import type { ServerSettings } from '../repositories/types';

export const CASE_RESPONDER_ROLE_IDS_SETTING_KEY = 'case_responder_role_ids';
export const CASE_RESPONDER_ROUTING_MODE_SETTING_KEY = 'case_responder_routing_mode';
export const CASE_RESPONDER_THREAD_MEMBER_CAP_SETTING_KEY = 'case_responder_thread_member_cap';

export const CASE_RESPONDER_ROUTING_MODES = ['off', 'ping_only', 'ping_and_add_members'] as const;

export type CaseResponderRoutingMode = (typeof CASE_RESPONDER_ROUTING_MODES)[number];

export interface CaseResponderSettings {
  roleIds: string[];
  routingMode: CaseResponderRoutingMode;
  threadMemberCap: number;
}

export const DEFAULT_CASE_RESPONDER_ROUTING_MODE: CaseResponderRoutingMode = 'off';
export const DEFAULT_CASE_RESPONDER_THREAD_MEMBER_CAP = 25;
export const MAX_CASE_RESPONDER_THREAD_MEMBER_CAP = 100;

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

export function isCaseResponderRoutingMode(value: unknown): value is CaseResponderRoutingMode {
  return (
    typeof value === 'string' &&
    CASE_RESPONDER_ROUTING_MODES.includes(value as CaseResponderRoutingMode)
  );
}

export function normalizeCaseResponderRoleIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const roleIds: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const roleId = item.trim();
    if (!DISCORD_ID_PATTERN.test(roleId) || seen.has(roleId)) {
      continue;
    }

    seen.add(roleId);
    roleIds.push(roleId);
  }

  return roleIds;
}

function readMemberCap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return DEFAULT_CASE_RESPONDER_THREAD_MEMBER_CAP;
  }

  return Math.min(Math.max(value, 1), MAX_CASE_RESPONDER_THREAD_MEMBER_CAP);
}

export function getCaseResponderSettings(settings: ServerSettings = {}): CaseResponderSettings {
  const routingMode = isCaseResponderRoutingMode(settings[CASE_RESPONDER_ROUTING_MODE_SETTING_KEY])
    ? settings[CASE_RESPONDER_ROUTING_MODE_SETTING_KEY]
    : DEFAULT_CASE_RESPONDER_ROUTING_MODE;

  return {
    roleIds: normalizeCaseResponderRoleIds(settings[CASE_RESPONDER_ROLE_IDS_SETTING_KEY]),
    routingMode,
    threadMemberCap: readMemberCap(settings[CASE_RESPONDER_THREAD_MEMBER_CAP_SETTING_KEY]),
  };
}
