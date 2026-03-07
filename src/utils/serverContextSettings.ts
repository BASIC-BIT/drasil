import type { ServerSettings } from '../repositories/types';

export const SERVER_ABOUT_SETTING_KEY = 'server_about';
export const VERIFICATION_CONTEXT_SETTING_KEY = 'verification_context';
export const EXPECTED_TOPICS_SETTING_KEY = 'expected_topics';

export interface ServerContextSettings {
  serverAbout?: string;
  verificationContext?: string;
  expectedTopics: string[];
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeExpectedTopics(topics: readonly string[] | null | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const rawTopic of topics ?? []) {
    const topic = rawTopic.trim();
    if (!topic) {
      continue;
    }

    const key = topic.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(topic);
  }

  return normalized;
}

export function decodeExpectedTopicsInput(rawTopics: string): string[] {
  const decoded = rawTopics.replace(/\\n/g, '\n');
  return normalizeExpectedTopics(decoded.split(/[\n,]+/));
}

export function getServerContextSettings(settings: ServerSettings): ServerContextSettings {
  return {
    serverAbout: normalizeOptionalText(settings[SERVER_ABOUT_SETTING_KEY]),
    verificationContext: normalizeOptionalText(settings[VERIFICATION_CONTEXT_SETTING_KEY]),
    expectedTopics: normalizeExpectedTopics(settings[EXPECTED_TOPICS_SETTING_KEY]),
  };
}

export function hasServerContext(settings: ServerContextSettings): boolean {
  return Boolean(
    settings.serverAbout || settings.verificationContext || settings.expectedTopics.length > 0
  );
}
