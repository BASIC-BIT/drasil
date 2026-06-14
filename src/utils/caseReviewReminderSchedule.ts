import type { VerificationEvent } from '../repositories/types';
import type { CaseReviewReminderSettings } from './caseReviewReminderSettings';
import { getSupportThreadReminderState } from './supportThreadReminderState';

export const SUPPORT_THREAD_REMINDER_INTERVAL_HOURS = 24;
export const ADMIN_REVIEW_WINDOW_HOURS = 1;
export const DEFAULT_SUPPORT_THREAD_REMINDER_TEMPLATE =
  'Ticket reminder: {elapsed} elapsed. {user_mention} See above.';

const HOUR_MS = 60 * 60 * 1000;
const DAY_HOURS = 24;

export type CaseFreshness = 'fresh' | 'stale' | 'very_stale';

export interface CaseReminderPlan {
  readonly freshness: CaseFreshness;
  readonly ageHours: number;
  readonly nextUserReminderAt: Date | null;
  readonly supportsUserReminder: boolean;
  readonly userReminderCount: number;
  readonly userReminderLimit: number;
  readonly userResponded: boolean;
  readonly userRemindersComplete: boolean;
}

export function buildCaseReminderPlan(
  event: VerificationEvent,
  settings: CaseReviewReminderSettings,
  now: Date,
  options: { lastAdminDigestAt?: Date | null; supportsUserReminder?: boolean } = {}
): CaseReminderPlan {
  const ageHours = getElapsedHours(event.updated_at, now);
  const veryStaleHours = Math.max(settings.veryStaleDays * DAY_HOURS, settings.staleHours);
  const veryStaleAt = addHours(event.updated_at, veryStaleHours);
  const freshness =
    ageHours >= veryStaleHours ? 'very_stale' : ageHours >= settings.staleHours ? 'stale' : 'fresh';
  const reminderState = getSupportThreadReminderState(event.metadata);
  const supportsUserReminder = options.supportsUserReminder !== false;
  const userReminderLimit = supportsUserReminder
    ? getUserReminderLimit(settings.staleHours, veryStaleHours)
    : 0;
  const userResponded = Boolean(reminderState.userRespondedAt);
  const cutoffReached = freshness === 'very_stale';
  let userRemindersComplete =
    supportsUserReminder && (cutoffReached || reminderState.reminderCount >= userReminderLimit);
  let nextUserReminderAt: Date | null = null;

  if (supportsUserReminder && !userResponded && !userRemindersComplete) {
    const candidate = avoidAdminReviewWindow(
      getRawNextUserReminderAt(event, reminderState.lastReminderAt, settings.staleHours),
      now,
      options.lastAdminDigestAt ?? null
    );
    if (candidate < veryStaleAt) {
      nextUserReminderAt = candidate;
    } else {
      userRemindersComplete = true;
    }
  }

  return {
    freshness,
    ageHours,
    nextUserReminderAt,
    supportsUserReminder,
    userReminderCount: Math.min(reminderState.reminderCount, userReminderLimit),
    userReminderLimit,
    userResponded,
    userRemindersComplete,
  };
}

export function renderSupportThreadReminder(event: VerificationEvent, now: Date): string {
  return DEFAULT_SUPPORT_THREAD_REMINDER_TEMPLATE.replace(
    /\{elapsed\}/gi,
    formatElapsed(getElapsedHours(event.updated_at, now))
  ).replace(/\{user_mention\}/gi, `<@${event.user_id}>`);
}

export function formatElapsed(hours: number): string {
  if (hours >= 48 && hours % DAY_HOURS === 0) {
    return `${hours / DAY_HOURS}d`;
  }

  return `${hours}h`;
}

function avoidAdminReviewWindow(candidate: Date, now: Date, lastAdminDigestAt: Date | null): Date {
  if (!lastAdminDigestAt) {
    return candidate;
  }

  const windowEnd = addHours(lastAdminDigestAt, ADMIN_REVIEW_WINDOW_HOURS);
  const nowIsInsideWindow = now.getTime() >= lastAdminDigestAt.getTime() && now < windowEnd;
  const candidateIsInsideWindow = candidate >= lastAdminDigestAt && candidate < windowEnd;
  const overdueDuringWindow = nowIsInsideWindow && candidate <= windowEnd;

  if (candidateIsInsideWindow || overdueDuringWindow) {
    return windowEnd;
  }

  return candidate;
}

function getElapsedHours(from: Date, to: Date): number {
  return Math.max(1, Math.floor((to.getTime() - from.getTime()) / HOUR_MS));
}

function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * HOUR_MS);
}

function getRawNextUserReminderAt(
  event: VerificationEvent,
  lastReminderAt: string | undefined,
  staleHours: number
): Date {
  const parsedLastReminderAt = parseDate(lastReminderAt);
  if (parsedLastReminderAt) {
    return addHours(parsedLastReminderAt, SUPPORT_THREAD_REMINDER_INTERVAL_HOURS);
  }

  return addHours(event.updated_at, staleHours);
}

function getUserReminderLimit(staleHours: number, veryStaleHours: number): number {
  const reminderWindowHours = veryStaleHours - staleHours;
  if (reminderWindowHours <= 0) {
    return 0;
  }

  return Math.ceil(reminderWindowHours / SUPPORT_THREAD_REMINDER_INTERVAL_HOURS);
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
