import type { ServerSettings } from '../repositories/types';

export const CAPTCHA_MODE_SETTING_KEY = 'captcha_mode';
export const CAPTCHA_PASS_ACTION_SETTING_KEY = 'captcha_pass_action';
export const CAPTCHA_CHALLENGE_LIFETIME_HOURS_SETTING_KEY = 'captcha_challenge_lifetime_hours';
export const CAPTCHA_MAX_SUBMISSIONS_SETTING_KEY = 'captcha_max_submissions';

export const DEFAULT_CAPTCHA_MODE = 'off' as const;
export const DEFAULT_CAPTCHA_PASS_ACTION = 'evidence_only' as const;
export const DEFAULT_CAPTCHA_CHALLENGE_LIFETIME_HOURS = 24;
export const DEFAULT_CAPTCHA_MAX_SUBMISSIONS = 5;

const MIN_LIFETIME_HOURS = 1;
const MAX_LIFETIME_HOURS = 168;
const MIN_SUBMISSIONS = 1;
const MAX_SUBMISSIONS = 20;

export type CaptchaMode = 'off' | 'manual' | 'suspicious_join';
export type CaptchaPassAction = 'evidence_only' | 'verify_join_only';

export interface CaptchaSettings {
  mode: CaptchaMode;
  passAction: CaptchaPassAction;
  challengeLifetimeHours: number;
  maxSubmissions: number;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

export function getCaptchaSettings(settings: ServerSettings | unknown): CaptchaSettings {
  const record =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {};
  const mode = record[CAPTCHA_MODE_SETTING_KEY];
  const passAction = record[CAPTCHA_PASS_ACTION_SETTING_KEY];

  return {
    mode:
      mode === 'manual' || mode === 'suspicious_join' || mode === 'off'
        ? mode
        : DEFAULT_CAPTCHA_MODE,
    passAction:
      passAction === 'verify_join_only' || passAction === 'evidence_only'
        ? passAction
        : DEFAULT_CAPTCHA_PASS_ACTION,
    challengeLifetimeHours: boundedInteger(
      record[CAPTCHA_CHALLENGE_LIFETIME_HOURS_SETTING_KEY],
      DEFAULT_CAPTCHA_CHALLENGE_LIFETIME_HOURS,
      MIN_LIFETIME_HOURS,
      MAX_LIFETIME_HOURS
    ),
    maxSubmissions: boundedInteger(
      record[CAPTCHA_MAX_SUBMISSIONS_SETTING_KEY],
      DEFAULT_CAPTCHA_MAX_SUBMISSIONS,
      MIN_SUBMISSIONS,
      MAX_SUBMISSIONS
    ),
  };
}
