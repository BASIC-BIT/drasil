export const ADMIN_ACTION_CUSTOM_ID_PREFIX = 'admin_actions';

export type AdminActionSurface = 'case' | 'observed';

export function buildCaseAdminActionsCustomId(userId: string): string {
  return `${ADMIN_ACTION_CUSTOM_ID_PREFIX}:menu:case:${userId}`;
}

export function buildObservedAdminActionsCustomId(
  userId: string,
  detectionEventId: string
): string {
  return `${ADMIN_ACTION_CUSTOM_ID_PREFIX}:menu:observed:${userId}:${detectionEventId}`;
}

export function buildAdminActionCustomId(
  action: string,
  surface: AdminActionSurface,
  userId: string,
  detectionEventId?: string
): string {
  return [ADMIN_ACTION_CUSTOM_ID_PREFIX, action, surface, userId, detectionEventId]
    .filter((part): part is string => Boolean(part))
    .join(':');
}

export interface ParsedAdminActionCustomId {
  readonly action: string;
  readonly surface: AdminActionSurface;
  readonly userId: string;
  readonly detectionEventId?: string;
}

export function parseAdminActionCustomId(customId: string): ParsedAdminActionCustomId | null {
  const [prefix, action, surface, userId, detectionEventId] = customId.split(':');
  if (prefix !== ADMIN_ACTION_CUSTOM_ID_PREFIX || !action || !surface || !userId) {
    return null;
  }
  if (surface !== 'case' && surface !== 'observed') {
    return null;
  }

  return {
    action,
    surface,
    userId,
    ...(detectionEventId ? { detectionEventId } : {}),
  };
}
