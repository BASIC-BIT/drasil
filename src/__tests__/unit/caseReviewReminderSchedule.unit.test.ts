import { VerificationEvent, VerificationStatus } from '../../repositories/types';
import {
  buildCaseReminderPlan,
  formatElapsed,
  renderSupportThreadReminder,
} from '../../utils/caseReviewReminderSchedule';
import { CaseReviewReminderSettings } from '../../utils/caseReviewReminderSettings';

const settings: CaseReviewReminderSettings = {
  enabled: true,
  staleHours: 24,
  repeatHours: 24,
  veryStaleDays: 3,
};

const buildEvent = (
  updatedAt: Date,
  metadata: VerificationEvent['metadata'] = null
): VerificationEvent => ({
  id: 'ver-1',
  server_id: 'guild-1',
  user_id: 'user-1',
  detection_event_id: null,
  thread_id: 'thread-1',
  private_evidence_thread_id: null,
  notification_channel_id: null,
  notification_message_id: null,
  status: VerificationStatus.PENDING,
  created_at: updatedAt,
  updated_at: updatedAt,
  resolved_at: null,
  resolved_by: null,
  notes: null,
  metadata,
});

describe('caseReviewReminderSchedule (unit)', () => {
  it('moves due user reminders to the end of the admin review window', () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'));

    const plan = buildCaseReminderPlan(event, settings, now, {
      lastAdminDigestAt: now,
      supportsUserReminder: true,
    });

    expect(plan.nextUserReminderAt?.toISOString()).toBe('2026-06-03T13:00:00.000Z');
    expect(plan.userReminderLimit).toBe(2);
  });

  it('uses the stale threshold for the first user reminder', () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'));

    const plan = buildCaseReminderPlan(event, { ...settings, staleHours: 48 }, now, {
      supportsUserReminder: true,
    });

    expect(plan.nextUserReminderAt?.toISOString()).toBe('2026-06-04T10:00:00.000Z');
    expect(plan.userReminderLimit).toBe(1);
  });

  it('marks cases very stale at the configured day threshold', () => {
    const now = new Date('2026-06-05T10:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'));

    const plan = buildCaseReminderPlan(event, settings, now, { supportsUserReminder: true });

    expect(plan.freshness).toBe('very_stale');
    expect(plan.nextUserReminderAt).toBeNull();
  });

  it('does not mark unsupported cases as user reminder complete', () => {
    const now = new Date('2026-06-05T10:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'));

    const plan = buildCaseReminderPlan(event, settings, now, { supportsUserReminder: false });

    expect(plan.supportsUserReminder).toBe(false);
    expect(plan.userReminderLimit).toBe(0);
    expect(plan.userRemindersComplete).toBe(false);
    expect(plan.nextUserReminderAt).toBeNull();
  });

  it('stops user reminders before a shifted reminder would cross the very-stale cutoff', () => {
    const now = new Date('2026-06-05T13:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'), {
      support_thread_reminder: {
        lastReminderAt: '2026-06-04T13:00:00.000Z',
        reminderCount: 2,
      },
    });

    const plan = buildCaseReminderPlan(event, settings, now, { supportsUserReminder: true });

    expect(plan.userRemindersComplete).toBe(true);
    expect(plan.userReminderLimit).toBe(2);
    expect(plan.userReminderCount).toBe(2);
    expect(plan.nextUserReminderAt).toBeNull();
  });

  it('caps reminders for custom stale thresholds before the very-stale cutoff', () => {
    const now = new Date('2026-06-05T10:00:00.000Z');
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'), {
      support_thread_reminder: {
        lastReminderAt: '2026-06-04T10:00:00.000Z',
        reminderCount: 1,
      },
    });

    const plan = buildCaseReminderPlan(event, { ...settings, staleHours: 48 }, now, {
      supportsUserReminder: true,
    });

    expect(plan.freshness).toBe('very_stale');
    expect(plan.userRemindersComplete).toBe(true);
    expect(plan.userReminderLimit).toBe(1);
    expect(plan.userReminderCount).toBe(1);
    expect(plan.nextUserReminderAt).toBeNull();
  });

  it('formats reminder copy with elapsed time', () => {
    const event = buildEvent(new Date('2026-06-02T10:00:00.000Z'));

    expect(renderSupportThreadReminder(event, new Date('2026-06-04T10:00:00.000Z'))).toBe(
      'Ticket reminder: 2d elapsed. <@user-1> See above.'
    );
    expect(formatElapsed(24)).toBe('24h');
  });
});
