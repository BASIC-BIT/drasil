import type { ServerSettings } from '../repositories/types';

export const CASE_REVIEW_REMINDERS_ENABLED_SETTING_KEY = 'case_review_reminders_enabled';
export const CASE_REVIEW_REMINDER_STALE_HOURS_SETTING_KEY = 'case_review_reminder_stale_hours';
export const CASE_REVIEW_REMINDER_REPEAT_HOURS_SETTING_KEY = 'case_review_reminder_repeat_hours';
export const CASE_REVIEW_DIGEST_LAST_SENT_AT_SETTING_KEY = 'case_review_digest_last_sent_at';

export const DEFAULT_CASE_REVIEW_REMINDER_STALE_HOURS = 24;
export const DEFAULT_CASE_REVIEW_REMINDER_REPEAT_HOURS = 24;
export const MIN_CASE_REVIEW_REMINDER_HOURS = 1;
export const MAX_CASE_REVIEW_REMINDER_HOURS = 168;

export interface CaseReviewReminderSettings {
  readonly enabled: boolean;
  readonly staleHours: number;
  readonly repeatHours: number;
}

function readHours(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, MIN_CASE_REVIEW_REMINDER_HOURS), MAX_CASE_REVIEW_REMINDER_HOURS);
}

export function getCaseReviewReminderSettings(
  settings: ServerSettings = {}
): CaseReviewReminderSettings {
  return {
    enabled: settings[CASE_REVIEW_REMINDERS_ENABLED_SETTING_KEY] === true,
    staleHours: readHours(
      settings[CASE_REVIEW_REMINDER_STALE_HOURS_SETTING_KEY],
      DEFAULT_CASE_REVIEW_REMINDER_STALE_HOURS
    ),
    repeatHours: readHours(
      settings[CASE_REVIEW_REMINDER_REPEAT_HOURS_SETTING_KEY],
      DEFAULT_CASE_REVIEW_REMINDER_REPEAT_HOURS
    ),
  };
}
