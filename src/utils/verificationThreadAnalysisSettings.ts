import type { ServerSettings } from '../repositories/types';

export const VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY =
  'verification_ai_thread_analysis_enabled';
export const VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY =
  'verification_ai_thread_analysis_message_limit';

export const DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED = false;
export const DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT = 3;
export const MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT = 10;

export interface VerificationThreadAnalysisSettings {
  enabled: boolean;
  messageLimit: number;
}

function coercePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT);
}

export function getVerificationThreadAnalysisSettings(
  settings: ServerSettings
): VerificationThreadAnalysisSettings {
  return {
    enabled:
      settings[VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY] ??
      DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED,
    messageLimit: coercePositiveInteger(
      settings[VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY],
      DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT
    ),
  };
}
