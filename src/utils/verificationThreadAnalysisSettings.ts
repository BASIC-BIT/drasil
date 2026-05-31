import type { ServerSettings } from '../repositories/types';

export const VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY =
  'verification_ai_thread_analysis_enabled';
export const VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY =
  'verification_ai_thread_analysis_message_limit';
export const VERIFICATION_AI_MAX_ACTION_SETTING_KEY = 'verification_ai_max_action';
export const VERIFICATION_AI_RESTRICT_THRESHOLD_SETTING_KEY = 'verification_ai_restrict_threshold';

export const DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED = true;
export const DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT = 3;
export const MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT = 10;
export const DEFAULT_VERIFICATION_AI_MAX_ACTION: VerificationAiMaxAction = 'hints';
export const DEFAULT_VERIFICATION_AI_RESTRICT_THRESHOLD = 0.95;

export const VERIFICATION_AI_MAX_ACTIONS = ['off', 'hints', 'restrict'] as const;
export type VerificationAiMaxAction = (typeof VERIFICATION_AI_MAX_ACTIONS)[number];

export interface VerificationThreadAnalysisSettings {
  enabled: boolean;
  messageLimit: number;
  maxAction: VerificationAiMaxAction;
  restrictThreshold: number;
}

export const VERIFICATION_THREAD_ANALYSIS_FETCH_LIMIT = 100;

function coercePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return fallback;
  }

  return Math.min(value, MAX_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT);
}

function coerceThreshold(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, 0), 1);
}

export function isVerificationAiMaxAction(value: unknown): value is VerificationAiMaxAction {
  return (
    typeof value === 'string' &&
    VERIFICATION_AI_MAX_ACTIONS.includes(value as VerificationAiMaxAction)
  );
}

export function getVerificationThreadAnalysisSettings(
  settings: ServerSettings
): VerificationThreadAnalysisSettings {
  const maxAction = isVerificationAiMaxAction(settings[VERIFICATION_AI_MAX_ACTION_SETTING_KEY])
    ? settings[VERIFICATION_AI_MAX_ACTION_SETTING_KEY]
    : DEFAULT_VERIFICATION_AI_MAX_ACTION;

  return {
    enabled:
      settings[VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY] ??
      DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_ENABLED,
    messageLimit: coercePositiveInteger(
      settings[VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY],
      DEFAULT_VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT
    ),
    maxAction,
    restrictThreshold: coerceThreshold(
      settings[VERIFICATION_AI_RESTRICT_THRESHOLD_SETTING_KEY],
      DEFAULT_VERIFICATION_AI_RESTRICT_THRESHOLD
    ),
  };
}
