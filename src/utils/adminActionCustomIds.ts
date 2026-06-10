export const ADMIN_ACTION_CUSTOM_ID_PREFIX = 'admin_actions';
const DISCORD_CUSTOM_ID_MAX_LENGTH = 100;

export type AdminActionSurface = 'case' | 'observed';

const SURFACE_TO_CODE: Record<AdminActionSurface, string> = {
  case: 'c',
  observed: 'o',
};
const CODE_TO_SURFACE: Record<string, AdminActionSurface> = {
  c: 'case',
  o: 'observed',
};

const ACTION_TO_CODE: Record<string, string> = {
  menu: 'm',
  history: 'h',
  ban: 'b',
  observed_ban: 'ob',
  verify: 'v',
  close_no_action: 'cna',
  thread: 't',
  repair: 'rp',
  sync_ban: 'sb',
  reopen: 'ro',
  observed_open: 'oo',
  observed_restrict: 'or',
  observed_dismiss: 'od',
  observed_false_positive: 'ofp',
  observed_undo_dismiss: 'oud',
  confirm_verify: 'cv',
  confirm_close_no_action: 'ccna',
  confirm_thread: 'ct',
  confirm_repair: 'crp',
  confirm_sync_ban: 'csb',
  confirm_reopen: 'cro',
  confirm_observed_open: 'coo',
  confirm_observed_restrict: 'cor',
  confirm_observed_dismiss: 'cod',
  confirm_observed_false_positive: 'cofp',
  confirm_observed_undo_dismiss: 'coud',
  cancel: 'x',
};
const CODE_TO_ACTION = Object.fromEntries(
  Object.entries(ACTION_TO_CODE).map(([action, code]) => [code, action])
) as Record<string, string>;

function assertCustomIdLength(customId: string): string {
  if (customId.length > DISCORD_CUSTOM_ID_MAX_LENGTH) {
    throw new Error(
      `Admin action custom_id exceeds Discord's ${DISCORD_CUSTOM_ID_MAX_LENGTH}-character limit.`
    );
  }

  return customId;
}

function parseSurface(value: string): AdminActionSurface | null {
  if (value === 'c' || value === 'case') {
    return 'case';
  }
  if (value === 'o' || value === 'observed') {
    return 'observed';
  }

  return null;
}

export function buildCaseAdminActionsCustomId(userId: string): string {
  return buildAdminActionCustomId('menu', 'case', userId);
}

export function buildObservedAdminActionsCustomId(
  userId: string,
  detectionEventId: string
): string {
  return buildAdminActionCustomId('menu', 'observed', userId, detectionEventId);
}

export function buildAdminActionCustomId(
  action: string,
  surface: AdminActionSurface,
  userId: string,
  detectionEventId?: string
): string {
  return assertCustomIdLength(
    [
      ADMIN_ACTION_CUSTOM_ID_PREFIX,
      ACTION_TO_CODE[action] ?? action,
      SURFACE_TO_CODE[surface],
      userId,
      detectionEventId,
    ]
      .filter((part): part is string => Boolean(part))
      .join(':')
  );
}

export interface ParsedAdminActionCustomId {
  readonly action: string;
  readonly surface: AdminActionSurface;
  readonly userId: string;
  readonly detectionEventId?: string;
}

export function parseAdminActionCustomId(customId: string): ParsedAdminActionCustomId | null {
  const [prefix, actionCode, surfaceCode, userId, detectionEventId] = customId.split(':');
  if (prefix !== ADMIN_ACTION_CUSTOM_ID_PREFIX || !actionCode || !surfaceCode || !userId) {
    return null;
  }
  const action = CODE_TO_ACTION[actionCode] ?? actionCode;
  const surface = parseSurface(CODE_TO_SURFACE[surfaceCode] ?? surfaceCode);
  if (!surface) {
    return null;
  }

  return {
    action,
    surface,
    userId,
    ...(detectionEventId ? { detectionEventId } : {}),
  };
}
