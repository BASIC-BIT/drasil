import {
  buildSetupSettingsPatch,
  getEffectiveCaptchaMethod,
  settingsSectionSchemas,
} from '@drasil/application';
import {
  DEFAULT_CAPTCHA_CHALLENGE_LIFETIME_HOURS,
  DEFAULT_CAPTCHA_MAX_SUBMISSIONS,
  getCaptchaSettings,
} from '../../utils/captchaSettings';

describe('getCaptchaSettings', () => {
  it('returns safe defaults', () => {
    expect(getCaptchaSettings({})).toEqual({
      method: 'none',
      methodRevision: 0,
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
      method: 'turnstile',
      methodRevision: 0,
      mode: 'suspicious_join',
      passAction: 'verify_join_only',
      challengeLifetimeHours: 168,
      maxSubmissions: 1,
    });
  });
});

describe('CAPTCHA method normalization', () => {
  it.each([
    [{}, 'none'],
    [{ captcha_mode: 'off' }, 'none'],
    [{ captcha_mode: 'manual' }, 'turnstile'],
    [{ captcha_mode: 'suspicious_join' }, 'turnstile'],
    [{ captcha_method: 'none', captcha_mode: 'manual' }, 'none'],
    [{ captcha_method: 'unknown', captcha_mode: 'manual' }, 'none'],
    [{ captcha_method: null, captcha_mode: 'manual' }, 'none'],
    [{ captcha_method: 'discord_image' }, 'discord_image'],
  ])('normalizes %j to %s without rewriting it', (settings, expected) => {
    const before = JSON.stringify(settings);
    expect(getEffectiveCaptchaMethod(settings)).toBe(expected);
    expect(getCaptchaSettings(settings).method).toBe(expected);
    expect(JSON.stringify(settings)).toBe(before);
  });

  it('defaults missing or malformed method revisions to zero', () => {
    expect(getCaptchaSettings({ captcha_method_revision: 4 }).methodRevision).toBe(4);
    for (const value of [-1, 1.5, '4', null]) {
      expect(getCaptchaSettings({ captcha_method_revision: value }).methodRevision).toBe(0);
    }
  });

  it.each(['manual', 'suspicious_join', 'off'] as const)(
    'keeps %s mode-only patches independent of the saved method',
    (captchaMode) => {
      const patch = buildSetupSettingsPatch({ guildId: 'fixture-guild', captchaMode });
      expect(patch).toEqual({ captcha_mode: captchaMode });
      for (const method of ['discord_image', 'none', 'turnstile'] as const) {
        const saved = {
          captcha_method: method,
          captcha_mode: 'manual',
          captcha_method_revision: 4,
        };
        expect({ ...saved, ...patch }).toEqual({
          captcha_method: method,
          captcha_mode: captchaMode,
          captcha_method_revision: 4,
        });
      }
      const legacy = { captcha_mode: 'manual', ...patch };
      expect(legacy).not.toHaveProperty('captcha_method');
      expect(getEffectiveCaptchaMethod(legacy)).toBe(captchaMode === 'off' ? 'none' : 'turnstile');
    }
  );

  it('writes only explicit method selections and rejects editable revision metadata', () => {
    expect(
      buildSetupSettingsPatch({
        guildId: 'fixture-guild',
        captchaMethod: 'none',
        captchaMode: 'manual',
      })
    ).toMatchObject({ captcha_method: 'none' });
    expect(
      buildSetupSettingsPatch({ guildId: 'fixture-guild', serverAbout: 'About' })
    ).not.toHaveProperty('captcha_method');
    expect(
      settingsSectionSchemas.verification.safeParse({ captcha_method_revision: 3 }).success
    ).toBe(false);
  });
});
