import { getCaseReviewReminderSettings } from '../../utils/caseReviewReminderSettings';

describe('caseReviewReminderSettings (unit)', () => {
  it('defaults reminders off with conservative intervals', () => {
    expect(getCaseReviewReminderSettings({})).toEqual({
      enabled: false,
      staleHours: 24,
      repeatHours: 24,
    });
  });

  it('coerces configured hours into safe bounds', () => {
    expect(
      getCaseReviewReminderSettings({
        case_review_reminders_enabled: true,
        case_review_reminder_stale_hours: 0,
        case_review_reminder_repeat_hours: 999,
      })
    ).toEqual({
      enabled: true,
      staleHours: 1,
      repeatHours: 168,
    });
  });
});
