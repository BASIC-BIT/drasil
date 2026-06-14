import { getCaseReviewReminderSettings } from '../../utils/caseReviewReminderSettings';

describe('caseReviewReminderSettings (unit)', () => {
  it('defaults reminders on with conservative intervals', () => {
    expect(getCaseReviewReminderSettings({})).toEqual({
      enabled: true,
      staleHours: 24,
      repeatHours: 24,
      veryStaleDays: 3,
    });
  });

  it('coerces configured hours and days into safe bounds', () => {
    expect(
      getCaseReviewReminderSettings({
        case_review_reminders_enabled: false,
        case_review_reminder_stale_hours: 0,
        case_review_reminder_repeat_hours: 999,
        case_review_very_stale_days: 999,
      })
    ).toEqual({
      enabled: false,
      staleHours: 1,
      repeatHours: 168,
      veryStaleDays: 30,
    });
  });
});
