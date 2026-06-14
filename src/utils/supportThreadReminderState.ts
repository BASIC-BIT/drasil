export const SUPPORT_THREAD_REMINDER_METADATA_KEY = 'support_thread_reminder';

export interface SupportThreadReminderState {
  readonly lastReminderAt?: string;
  readonly reminderCount: number;
  readonly userRespondedAt?: string;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return { ...(value as Record<string, unknown>) };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function readReminderCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function compactState(state: Partial<SupportThreadReminderState>): Record<string, unknown> {
  const compacted: Record<string, unknown> = {};
  if (state.lastReminderAt !== undefined) {
    compacted.lastReminderAt = state.lastReminderAt;
  }
  if (state.reminderCount !== undefined) {
    compacted.reminderCount = state.reminderCount;
  }
  if (state.userRespondedAt !== undefined) {
    compacted.userRespondedAt = state.userRespondedAt;
  }

  return compacted;
}

export function getSupportThreadReminderState(metadata: unknown): SupportThreadReminderState {
  const root = toRecord(metadata);
  const reminder = toRecord(root[SUPPORT_THREAD_REMINDER_METADATA_KEY]);

  return {
    lastReminderAt: readString(reminder.lastReminderAt),
    reminderCount: readReminderCount(reminder.reminderCount),
    userRespondedAt: readString(reminder.userRespondedAt),
  };
}

export function withSupportThreadReminderState(
  metadata: unknown,
  nextState: Partial<SupportThreadReminderState>
): Record<string, unknown> {
  const root = toRecord(metadata);
  return {
    ...root,
    [SUPPORT_THREAD_REMINDER_METADATA_KEY]: compactState(nextState),
  };
}

export function markSupportThreadReminderSent(
  metadata: unknown,
  now: Date
): Record<string, unknown> {
  const state = getSupportThreadReminderState(metadata);
  return withSupportThreadReminderState(metadata, {
    ...state,
    lastReminderAt: now.toISOString(),
    reminderCount: state.reminderCount + 1,
  });
}

export function markSupportThreadReminderUserResponded(
  metadata: unknown,
  respondedAt: Date
): Record<string, unknown> {
  const state = getSupportThreadReminderState(metadata);
  return withSupportThreadReminderState(metadata, {
    ...state,
    userRespondedAt: respondedAt.toISOString(),
  });
}
