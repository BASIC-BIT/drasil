import type { ServerSettings } from '../repositories/types';

export const REPORT_INTAKE_AGENT_ENABLED_SETTING_KEY = 'report_intake_agent_enabled';
export const REPORT_INTAKE_AGENT_DEBOUNCE_MS_SETTING_KEY = 'report_intake_agent_debounce_ms';
export const REPORT_INTAKE_AGENT_MIN_INTERVAL_MS_SETTING_KEY =
  'report_intake_agent_min_interval_ms';
export const REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY =
  'report_intake_confirmed_response_mode';

export const REPORT_INTAKE_CONFIRMED_RESPONSE_MODES = [
  'observed_alert',
  'open_case',
  'restrict',
  'kick',
] as const;

export type ReportIntakeConfirmedResponseMode =
  (typeof REPORT_INTAKE_CONFIRMED_RESPONSE_MODES)[number];

export interface ReportIntakeSettings {
  agentEnabled: boolean;
  debounceMs: number;
  minAnalysisIntervalMs: number;
  confirmedResponseMode: ReportIntakeConfirmedResponseMode;
}

export const DEFAULT_REPORT_INTAKE_AGENT_ENABLED = true;
export const DEFAULT_REPORT_INTAKE_AGENT_DEBOUNCE_MS = 15_000;
export const DEFAULT_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS = 60_000;
export const MIN_REPORT_INTAKE_AGENT_DEBOUNCE_MS = 5_000;
export const MAX_REPORT_INTAKE_AGENT_DEBOUNCE_MS = 60_000;
export const MIN_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS = 30_000;
export const MAX_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS = 5 * 60_000;

export function getReportIntakeSettings(settings: ServerSettings = {}): ReportIntakeSettings {
  return {
    agentEnabled: readBoolean(
      settings[REPORT_INTAKE_AGENT_ENABLED_SETTING_KEY],
      DEFAULT_REPORT_INTAKE_AGENT_ENABLED
    ),
    debounceMs: readInteger(
      settings[REPORT_INTAKE_AGENT_DEBOUNCE_MS_SETTING_KEY],
      DEFAULT_REPORT_INTAKE_AGENT_DEBOUNCE_MS,
      MIN_REPORT_INTAKE_AGENT_DEBOUNCE_MS,
      MAX_REPORT_INTAKE_AGENT_DEBOUNCE_MS
    ),
    minAnalysisIntervalMs: readInteger(
      settings[REPORT_INTAKE_AGENT_MIN_INTERVAL_MS_SETTING_KEY],
      DEFAULT_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS,
      MIN_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS,
      MAX_REPORT_INTAKE_AGENT_MIN_INTERVAL_MS
    ),
    confirmedResponseMode: readConfirmedResponseMode(
      settings[REPORT_INTAKE_CONFIRMED_RESPONSE_MODE_SETTING_KEY]
    ),
  };
}

export function isReportIntakeConfirmedResponseMode(
  value: unknown
): value is ReportIntakeConfirmedResponseMode {
  return (
    typeof value === 'string' &&
    REPORT_INTAKE_CONFIRMED_RESPONSE_MODES.includes(value as ReportIntakeConfirmedResponseMode)
  );
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function readConfirmedResponseMode(value: unknown): ReportIntakeConfirmedResponseMode {
  return isReportIntakeConfirmedResponseMode(value) ? value : 'observed_alert';
}
