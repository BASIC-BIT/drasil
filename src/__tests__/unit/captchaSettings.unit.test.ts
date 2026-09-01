import {
  DEFAULT_CAPTCHA_CHALLENGE_LIFETIME_HOURS,
  DEFAULT_CAPTCHA_MAX_SUBMISSIONS,
  getCaptchaSettings,
} from '../../utils/captchaSettings';

describe('getCaptchaSettings', () => {
  it('returns safe defaults', () => {
    expect(getCaptchaSettings({})).toEqual({
      mode: 'off',
      passAction: 'evidence_only',
      challengeLifetimeHours: DEFAULT_CAPTCHA_CHALLENGE_LIFETIME_HOURS,
      maxSubmissions: DEFAULT_CAPTCHA_MAX_SUBMISSIONS,
    });
  });

  it('accepts configured policy and bounds numeric settings', () => {
    expect(
      getCaptchaSettings({
        captcha_mode: 'suspicious_join',
        captcha_pass_action: 'verify_join_only',
        captcha_challenge_lifetime_hours: 1000,
        captcha_max_submissions: 0,
      })
    ).toEqual({
      mode: 'suspicious_join',
      passAction: 'verify_join_only',
      challengeLifetimeHours: 168,
      maxSubmissions: 1,
    });
  });
});
