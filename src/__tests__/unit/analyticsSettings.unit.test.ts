import {
  DEFAULT_ANALYTICS_CONSENT_LEVEL,
  getAnalyticsSettings,
  isAnalyticsConsentLevel,
} from '../../utils/analyticsSettings';

describe('analyticsSettings (unit)', () => {
  it('defaults to anonymous sharing', () => {
    expect(getAnalyticsSettings({}).consentLevel).toBe(DEFAULT_ANALYTICS_CONSENT_LEVEL);
  });

  it('accepts supported consent levels', () => {
    expect(isAnalyticsConsentLevel('off')).toBe(true);
    expect(isAnalyticsConsentLevel('anonymous')).toBe(true);
    expect(isAnalyticsConsentLevel('full')).toBe(true);
  });

  it('rejects unsupported consent levels', () => {
    expect(isAnalyticsConsentLevel('disabled')).toBe(false);
    expect(
      getAnalyticsSettings({ analytics_consent_level: 'disabled' as never }).consentLevel
    ).toBe('anonymous');
  });
});
