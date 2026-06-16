import { ServerSettings } from '../repositories/types';

export const DETECTION_RESPONSE_MODE_SETTING_KEY = 'detection_response_mode';
export const MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY = 'message_detection_response_mode';
export const JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY = 'join_detection_response_mode';
export const OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY =
  'observed_detection_notification_channel_id';
export const OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY =
  'observed_detection_min_confidence_threshold';
export const OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY =
  'observed_detection_notification_window_minutes';
export const AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY =
  'automatic_detection_exempt_moderators';
export const OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY =
  'observed_action_ban_requires_reason';
export const MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY = 'moderator_ban_action_enabled';
export const MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY = 'moderator_kick_action_enabled';
export const OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY = 'observed_action_kick_enabled';
export const MESSAGE_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY =
  'message_detection_auto_kick_enabled';
export const JOIN_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY = 'join_detection_auto_kick_enabled';
export const REPORT_INTAKE_AUTO_KICK_ENABLED_SETTING_KEY = 'report_intake_auto_kick_enabled';
export const AUTO_KICK_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY = 'auto_kick_min_confidence_threshold';

export const DETECTION_RESPONSE_MODES = ['off', 'record_only', 'notify_only', 'restrict'] as const;

export type DetectionResponseMode = (typeof DETECTION_RESPONSE_MODES)[number];
export type DetectionResponseEvent = 'message' | 'join';

export const DEFAULT_DETECTION_RESPONSE_MODE: DetectionResponseMode = 'restrict';
export const DEFAULT_MODERATOR_BAN_ACTION_ENABLED = true;
export const DEFAULT_MODERATOR_KICK_ACTION_ENABLED = true;
export const DEFAULT_OBSERVED_ACTION_KICK_ENABLED = false;
export const DEFAULT_MESSAGE_DETECTION_AUTO_KICK_ENABLED = false;
export const DEFAULT_JOIN_DETECTION_AUTO_KICK_ENABLED = false;
export const DEFAULT_REPORT_INTAKE_AUTO_KICK_ENABLED = false;
export const DEFAULT_AUTO_KICK_MIN_CONFIDENCE_THRESHOLD = 95;
export const MIN_AUTO_KICK_CONFIDENCE_THRESHOLD = 90;
export const MAX_AUTO_KICK_CONFIDENCE_THRESHOLD = 100;

export interface DetectionResponseSettings {
  mode: DetectionResponseMode;
  defaultMode: DetectionResponseMode;
  messageMode: DetectionResponseMode;
  joinMode: DetectionResponseMode;
  observedNotificationChannelId?: string;
  observedMinConfidenceThreshold: number;
  observedNotificationWindowMinutes: number;
  automaticDetectionExemptModerators: boolean;
  observedActionBanRequiresReason: boolean;
  moderatorBanActionEnabled: boolean;
  moderatorKickActionEnabled: boolean;
  observedActionKickEnabled: boolean;
  messageDetectionAutoKickEnabled: boolean;
  joinDetectionAutoKickEnabled: boolean;
  reportIntakeAutoKickEnabled: boolean;
  autoKickMinConfidenceThreshold: number;
}

export const DEFAULT_OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD = 70;
export const DEFAULT_OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES = 60;

export function isDetectionResponseMode(value: unknown): value is DetectionResponseMode {
  return (
    typeof value === 'string' && DETECTION_RESPONSE_MODES.includes(value as DetectionResponseMode)
  );
}

function readDetectionResponseMode(value: unknown): DetectionResponseMode | undefined {
  if (isDetectionResponseMode(value)) {
    return value;
  }

  if (value === 'open_case') {
    return 'notify_only';
  }

  return undefined;
}

function readNumberSetting(
  value: unknown,
  defaultValue: number,
  minimum: number,
  maximum: number
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

export function getDetectionResponseSettings(
  settings: ServerSettings,
  event?: DetectionResponseEvent
): DetectionResponseSettings {
  const configuredMode = readDetectionResponseMode(settings[DETECTION_RESPONSE_MODE_SETTING_KEY]);
  const defaultMode = configuredMode
    ? configuredMode
    : settings.auto_restrict === true
      ? 'restrict'
      : settings.auto_restrict === false
        ? 'notify_only'
        : DEFAULT_DETECTION_RESPONSE_MODE;
  const messageMode =
    readDetectionResponseMode(settings[MESSAGE_DETECTION_RESPONSE_MODE_SETTING_KEY]) ?? defaultMode;
  const joinMode =
    readDetectionResponseMode(settings[JOIN_DETECTION_RESPONSE_MODE_SETTING_KEY]) ?? defaultMode;
  const mode = event === 'message' ? messageMode : event === 'join' ? joinMode : defaultMode;

  const observedNotificationChannelId =
    typeof settings[OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY] === 'string'
      ? settings[OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY].trim()
      : undefined;

  return {
    mode,
    defaultMode,
    messageMode,
    joinMode,
    observedNotificationChannelId: observedNotificationChannelId || undefined,
    observedMinConfidenceThreshold: readNumberSetting(
      settings[OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY],
      DEFAULT_OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD,
      0,
      100
    ),
    observedNotificationWindowMinutes: readNumberSetting(
      settings[OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY],
      DEFAULT_OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES,
      1,
      1440
    ),
    automaticDetectionExemptModerators:
      settings[AUTOMATIC_DETECTION_EXEMPT_MODERATORS_SETTING_KEY] !== false,
    observedActionBanRequiresReason:
      settings[OBSERVED_ACTION_BAN_REQUIRES_REASON_SETTING_KEY] === true,
    moderatorBanActionEnabled:
      settings[MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY] ?? DEFAULT_MODERATOR_BAN_ACTION_ENABLED,
    moderatorKickActionEnabled:
      settings[MODERATOR_KICK_ACTION_ENABLED_SETTING_KEY] ?? DEFAULT_MODERATOR_KICK_ACTION_ENABLED,
    observedActionKickEnabled:
      settings[OBSERVED_ACTION_KICK_ENABLED_SETTING_KEY] ?? DEFAULT_OBSERVED_ACTION_KICK_ENABLED,
    messageDetectionAutoKickEnabled:
      settings[MESSAGE_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY] ??
      DEFAULT_MESSAGE_DETECTION_AUTO_KICK_ENABLED,
    joinDetectionAutoKickEnabled:
      settings[JOIN_DETECTION_AUTO_KICK_ENABLED_SETTING_KEY] ??
      DEFAULT_JOIN_DETECTION_AUTO_KICK_ENABLED,
    reportIntakeAutoKickEnabled:
      settings[REPORT_INTAKE_AUTO_KICK_ENABLED_SETTING_KEY] ??
      DEFAULT_REPORT_INTAKE_AUTO_KICK_ENABLED,
    autoKickMinConfidenceThreshold: readNumberSetting(
      settings[AUTO_KICK_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY],
      DEFAULT_AUTO_KICK_MIN_CONFIDENCE_THRESHOLD,
      MIN_AUTO_KICK_CONFIDENCE_THRESHOLD,
      MAX_AUTO_KICK_CONFIDENCE_THRESHOLD
    ),
  };
}
