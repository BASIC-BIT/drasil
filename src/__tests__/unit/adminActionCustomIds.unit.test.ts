import {
  buildAdminActionCustomId,
  parseAdminActionCustomId,
} from '../../utils/adminActionCustomIds';
import {
  buildReportIntakeAdminActionsCustomId,
  buildReportIntakeAdminConfirmCloseCustomId,
  parseReportIntakeAdminActionCustomId,
} from '../../utils/reportIntakeAdminActions';

describe('adminActionCustomIds (unit)', () => {
  it('keeps observed confirmation IDs under Discord custom_id limits', () => {
    const userId = '1234567890123456789';
    const detectionEventId = '12345678-1234-1234-1234-123456789012';

    const customId = buildAdminActionCustomId(
      'confirm_observed_false_positive',
      'observed',
      userId,
      detectionEventId
    );

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAdminActionCustomId(customId)).toEqual({
      action: 'confirm_observed_false_positive',
      surface: 'observed',
      userId,
      detectionEventId,
    });
  });

  it('keeps observed close-report confirmation IDs under Discord custom_id limits', () => {
    const userId = '1234567890123456789';
    const detectionEventId = '12345678-1234-1234-1234-123456789012';

    const customId = buildAdminActionCustomId(
      'confirm_observed_close_report',
      'observed',
      userId,
      detectionEventId
    );

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAdminActionCustomId(customId)).toEqual({
      action: 'confirm_observed_close_report',
      surface: 'observed',
      userId,
      detectionEventId,
    });
  });

  it('binds quarantine confirmation IDs to the previewed case', () => {
    const userId = '1234567890123456789';
    const verificationEventId = '12345678-1234-1234-1234-123456789012';
    const confirmationFingerprint = '0123456789abcdef0123';

    const customId = buildAdminActionCustomId(
      'confirm_quarantine',
      'case',
      userId,
      undefined,
      verificationEventId,
      confirmationFingerprint
    );

    expect(customId.length).toBeLessThanOrEqual(100);
    expect(parseAdminActionCustomId(customId)).toEqual({
      action: 'confirm_quarantine',
      surface: 'case',
      userId,
      verificationEventId,
      confirmationFingerprint,
    });
  });

  it('binds CAPTCHA retry confirmations to the displayed challenge generation', () => {
    const userId = '1234567890123456789';
    const challengeId = '12345678-1234-1234-1234-123456789012';

    for (const action of ['captcha_retry', 'confirm_captcha_retry']) {
      const customId = buildAdminActionCustomId(
        action,
        'case',
        userId,
        undefined,
        undefined,
        undefined,
        challengeId,
        7
      );

      expect(customId.length).toBeLessThanOrEqual(100);
      expect(parseAdminActionCustomId(customId)).toEqual({
        action,
        surface: 'case',
        userId,
        captchaChallengeId: challengeId,
        captchaGeneration: 7,
      });
    }
  });

  it('does not map old observed-restrict custom ID codes', () => {
    expect(parseAdminActionCustomId('admin_actions:or:o:user-1:det-1')).toEqual({
      action: 'or',
      surface: 'observed',
      userId: 'user-1',
      detectionEventId: 'det-1',
    });
    expect(parseAdminActionCustomId('admin_actions:cor:o:user-1:det-1')).toEqual({
      action: 'cor',
      surface: 'observed',
      userId: 'user-1',
      detectionEventId: 'det-1',
    });
  });

  it('keeps report intake admin action IDs under Discord custom_id limits', () => {
    const intakeId = '12345678-1234-1234-1234-123456789012';

    const menuCustomId = buildReportIntakeAdminActionsCustomId(intakeId);
    const confirmCloseCustomId = buildReportIntakeAdminConfirmCloseCustomId(intakeId);

    expect(menuCustomId.length).toBeLessThanOrEqual(100);
    expect(confirmCloseCustomId.length).toBeLessThanOrEqual(100);
    expect(parseReportIntakeAdminActionCustomId(menuCustomId)).toEqual({
      action: 'menu',
      intakeId,
    });
    expect(parseReportIntakeAdminActionCustomId(confirmCloseCustomId)).toEqual({
      action: 'confirm_close',
      intakeId,
    });
  });

  it('rejects verbose report intake admin action names', () => {
    const intakeId = '12345678-1234-1234-1234-123456789012';

    expect(
      parseReportIntakeAdminActionCustomId(`report_intake_admin:close:${intakeId}`)
    ).toBeNull();
    expect(
      parseReportIntakeAdminActionCustomId(`report_intake_admin:confirm_close:${intakeId}`)
    ).toBeNull();
  });
});
