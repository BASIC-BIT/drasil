import type { ServerSettings } from '../repositories/types';

export const ANALYTICS_CONSENT_SETTING_KEY = 'analytics_consent_level';
export const ANALYTICS_CONSENT_LEVELS = ['off', 'anonymous', 'full'] as const;
export const DEFAULT_ANALYTICS_CONSENT_LEVEL: AnalyticsConsentLevel = 'anonymous';

export type AnalyticsConsentLevel = (typeof ANALYTICS_CONSENT_LEVELS)[number];

export interface AnalyticsSettings {
  consentLevel: AnalyticsConsentLevel;
}

export function isAnalyticsConsentLevel(value: unknown): value is AnalyticsConsentLevel {
  return (
    typeof value === 'string' && ANALYTICS_CONSENT_LEVELS.includes(value as AnalyticsConsentLevel)
  );
}

export function getAnalyticsSettings(settings: ServerSettings = {}): AnalyticsSettings {
  const configuredLevel = settings[ANALYTICS_CONSENT_SETTING_KEY];

  return {
    consentLevel: isAnalyticsConsentLevel(configuredLevel)
      ? configuredLevel
      : DEFAULT_ANALYTICS_CONSENT_LEVEL,
  };
}
