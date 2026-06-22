import type { ServerSettings } from '../repositories/types';

export const MANUAL_INTAKE_ENABLED_SETTING_KEY = 'manual_intake_enabled';
export const MANUAL_INTAKE_ROLE_ID_SETTING_KEY = 'manual_intake_role_id';
export const MANUAL_INTAKE_GRACE_PERIOD_SECONDS_SETTING_KEY = 'manual_intake_grace_period_seconds';

export const DEFAULT_MANUAL_INTAKE_GRACE_PERIOD_SECONDS = 30;
export const MIN_MANUAL_INTAKE_GRACE_PERIOD_SECONDS = 0;
export const MAX_MANUAL_INTAKE_GRACE_PERIOD_SECONDS = 300;

export interface ManualIntakeSettings {
  readonly enabled: boolean;
  readonly roleId: string | null;
  readonly gracePeriodSeconds: number;
}

export function getManualIntakeSettings(settings: ServerSettings = {}): ManualIntakeSettings {
  return {
    enabled: readBoolean(settings[MANUAL_INTAKE_ENABLED_SETTING_KEY], false),
    roleId: readString(settings[MANUAL_INTAKE_ROLE_ID_SETTING_KEY]),
    gracePeriodSeconds: readInteger(
      settings[MANUAL_INTAKE_GRACE_PERIOD_SECONDS_SETTING_KEY],
      DEFAULT_MANUAL_INTAKE_GRACE_PERIOD_SECONDS,
      MIN_MANUAL_INTAKE_GRACE_PERIOD_SECONDS,
      MAX_MANUAL_INTAKE_GRACE_PERIOD_SECONDS
    ),
  };
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}
