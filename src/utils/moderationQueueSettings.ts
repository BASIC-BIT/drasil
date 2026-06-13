import { ServerSettings } from '../repositories/types';

export const MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY = 'moderation_queue_channel_id';

export interface ModerationQueueSettings {
  readonly channelId: string | null;
}

export function getModerationQueueSettings(
  settings?: ServerSettings | null
): ModerationQueueSettings {
  const channelId = settings?.[MODERATION_QUEUE_CHANNEL_ID_SETTING_KEY];
  return {
    channelId: typeof channelId === 'string' && channelId.trim() ? channelId : null,
  };
}
