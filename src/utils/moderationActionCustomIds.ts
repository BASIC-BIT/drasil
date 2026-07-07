export const MODERATION_ACTION_REASON_MODAL_PREFIX = 'moderation_action_reason';
export const MODERATION_ACTION_REASON_FIELD_ID = 'moderation_action_reason';
export const MODERATOR_ACTION_BAN_DEFAULT_REASON = 'Banned by moderator action';
export const MODERATOR_ACTION_KICK_DEFAULT_REASON = 'Kicked by moderator action';

export type ModeratorUserAction = 'ban' | 'kick';

export interface ModerationActionReasonModalData {
  readonly action: ModeratorUserAction;
  readonly targetUserId: string;
  readonly sourceChannelId?: string;
  readonly sourceMessageId?: string;
}

export function buildModerationActionReasonModalCustomId(
  action: ModeratorUserAction,
  targetUserId: string,
  sourceChannelId?: string,
  sourceMessageId?: string
): string {
  const parts = [MODERATION_ACTION_REASON_MODAL_PREFIX, action, targetUserId];
  if (sourceChannelId && sourceMessageId) {
    parts.push(sourceChannelId, sourceMessageId);
  }
  return parts.join(':');
}

export function parseModerationActionReasonModalCustomId(
  customId: string
): ModerationActionReasonModalData | null {
  const [prefix, action, targetUserId, sourceChannelId, sourceMessageId] = customId.split(':');
  if (
    prefix !== MODERATION_ACTION_REASON_MODAL_PREFIX ||
    (action !== 'ban' && action !== 'kick') ||
    !targetUserId
  ) {
    return null;
  }

  if ((sourceChannelId && !sourceMessageId) || (!sourceChannelId && sourceMessageId)) {
    return null;
  }

  return {
    action,
    targetUserId,
    ...(sourceChannelId && sourceMessageId ? { sourceChannelId, sourceMessageId } : {}),
  };
}
