import type { ServerSettings } from '../repositories/types';

export const PENDING_SCREENING_ALERTS_ENABLED_SETTING_KEY = 'pending_screening_alerts_enabled';
export const PENDING_SCREENING_LONG_PENDING_DAYS_SETTING_KEY =
  'pending_screening_long_pending_days';

export const DEFAULT_PENDING_SCREENING_LONG_PENDING_DAYS = 7;
const MIN_PENDING_SCREENING_LONG_PENDING_DAYS = 1;
const MAX_PENDING_SCREENING_LONG_PENDING_DAYS = 30;

export interface PendingScreeningSettings {
  readonly enabled: boolean;
  readonly longPendingDays: number;
}

function readDays(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(
    Math.max(value, MIN_PENDING_SCREENING_LONG_PENDING_DAYS),
    MAX_PENDING_SCREENING_LONG_PENDING_DAYS
  );
}

export function getPendingScreeningSettings(
  settings: ServerSettings = {}
): PendingScreeningSettings {
  return {
    enabled: settings[PENDING_SCREENING_ALERTS_ENABLED_SETTING_KEY] !== false,
    longPendingDays: readDays(
      settings[PENDING_SCREENING_LONG_PENDING_DAYS_SETTING_KEY],
      DEFAULT_PENDING_SCREENING_LONG_PENDING_DAYS
    ),
  };
}
