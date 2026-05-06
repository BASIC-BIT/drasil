import { ServerSettings } from '../repositories/types';

export const DETECTION_RESPONSE_MODE_SETTING_KEY = 'detection_response_mode';
export const OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY =
  'observed_detection_notification_channel_id';
export const OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD_SETTING_KEY =
  'observed_detection_min_confidence_threshold';
export const OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES_SETTING_KEY =
  'observed_detection_notification_window_minutes';

export const DETECTION_RESPONSE_MODES = [
  'off',
  'record_only',
  'notify_only',
  'open_case',
  'restrict',
] as const;

export type DetectionResponseMode = (typeof DETECTION_RESPONSE_MODES)[number];

export interface DetectionResponseSettings {
  mode: DetectionResponseMode;
  observedNotificationChannelId?: string;
  observedMinConfidenceThreshold: number;
  observedNotificationWindowMinutes: number;
}

export const DEFAULT_OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD = 70;
export const DEFAULT_OBSERVED_DETECTION_NOTIFICATION_WINDOW_MINUTES = 60;

export function isDetectionResponseMode(value: unknown): value is DetectionResponseMode {
  return (
    typeof value === 'string' && DETECTION_RESPONSE_MODES.includes(value as DetectionResponseMode)
  );
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

export function getDetectionResponseSettings(settings: ServerSettings): DetectionResponseSettings {
  const configuredMode = settings[DETECTION_RESPONSE_MODE_SETTING_KEY];
  const mode = isDetectionResponseMode(configuredMode)
    ? configuredMode
    : settings.auto_restrict === false
      ? 'notify_only'
      : 'restrict';

  const observedNotificationChannelId =
    typeof settings[OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY] === 'string'
      ? settings[OBSERVED_DETECTION_NOTIFICATION_CHANNEL_ID_SETTING_KEY].trim()
      : undefined;

  return {
    mode,
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
  };
}
