import type { ServerSettings } from '../repositories/types';

export const REPORT_AI_TRIAGE_ENABLED_SETTING_KEY = 'report_ai_triage_enabled';
export const REPORT_AI_ANALYZE_TEXT_SETTING_KEY = 'report_ai_analyze_text';
export const REPORT_AI_ANALYZE_IMAGES_SETTING_KEY = 'report_ai_analyze_images';
export const REPORT_AI_MAX_ACTION_SETTING_KEY = 'report_ai_max_action';
export const REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY = 'report_ai_open_case_threshold';
export const REPORT_AI_RESTRICT_THRESHOLD_SETTING_KEY = 'report_ai_restrict_threshold';
export const REPORT_AI_MAX_IMAGES_SETTING_KEY = 'report_ai_max_images';
export const REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY = 'report_ai_max_image_bytes';

export const REPORT_AI_MAX_ACTIONS = ['off', 'hints', 'open_case', 'restrict'] as const;
export type ReportAiMaxAction = (typeof REPORT_AI_MAX_ACTIONS)[number];

export interface ReportAiSettings {
  enabled: boolean;
  analyzeText: boolean;
  analyzeImages: boolean;
  maxAction: ReportAiMaxAction;
  openCaseThreshold: number;
  restrictThreshold: number;
  maxImages: number;
  maxImageBytes: number;
}

export interface ReportAttachmentMetadata {
  id?: string;
  name?: string;
  url?: string;
  proxyUrl?: string;
  contentType?: string;
  size?: number;
}

export const DEFAULT_REPORT_AI_OPEN_CASE_THRESHOLD = 0.85;
export const DEFAULT_REPORT_AI_RESTRICT_THRESHOLD = 0.95;
export const DEFAULT_REPORT_AI_MAX_IMAGES = 4;
export const DEFAULT_REPORT_AI_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_REPORT_AI_MAX_IMAGES = 8;
export const MAX_REPORT_AI_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

function readInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, minimum), maximum);
}

export function isReportAiMaxAction(value: unknown): value is ReportAiMaxAction {
  return typeof value === 'string' && REPORT_AI_MAX_ACTIONS.includes(value as ReportAiMaxAction);
}

export function getReportAiSettings(settings: ServerSettings = {}): ReportAiSettings {
  const maxAction = isReportAiMaxAction(settings[REPORT_AI_MAX_ACTION_SETTING_KEY])
    ? settings[REPORT_AI_MAX_ACTION_SETTING_KEY]
    : 'hints';

  return {
    enabled: readBoolean(settings[REPORT_AI_TRIAGE_ENABLED_SETTING_KEY], false),
    analyzeText: readBoolean(settings[REPORT_AI_ANALYZE_TEXT_SETTING_KEY], true),
    analyzeImages: readBoolean(settings[REPORT_AI_ANALYZE_IMAGES_SETTING_KEY], true),
    maxAction,
    openCaseThreshold: readNumber(
      settings[REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY],
      DEFAULT_REPORT_AI_OPEN_CASE_THRESHOLD,
      0,
      1
    ),
    restrictThreshold: readNumber(
      settings[REPORT_AI_RESTRICT_THRESHOLD_SETTING_KEY],
      DEFAULT_REPORT_AI_RESTRICT_THRESHOLD,
      0,
      1
    ),
    maxImages: readInteger(
      settings[REPORT_AI_MAX_IMAGES_SETTING_KEY],
      DEFAULT_REPORT_AI_MAX_IMAGES,
      0,
      MAX_REPORT_AI_MAX_IMAGES
    ),
    maxImageBytes: readInteger(
      settings[REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY],
      DEFAULT_REPORT_AI_MAX_IMAGE_BYTES,
      1,
      MAX_REPORT_AI_MAX_IMAGE_BYTES
    ),
  };
}

export function isEligibleReportImageAttachment(
  attachment: ReportAttachmentMetadata,
  settings: ReportAiSettings
): boolean {
  if (!settings.analyzeImages || settings.maxImages < 1) {
    return false;
  }

  const url = attachment.url?.trim();
  if (!url || !/^https:\/\//i.test(url)) {
    return false;
  }

  if (typeof attachment.size === 'number' && attachment.size > settings.maxImageBytes) {
    return false;
  }

  const contentType = attachment.contentType?.toLowerCase() ?? '';
  if (contentType.startsWith('image/')) {
    return true;
  }

  const name = attachment.name?.toLowerCase() ?? url.toLowerCase();
  return /\.(png|jpe?g|webp|gif)(\?|#|$)/.test(name);
}

export function selectEligibleReportImageAttachments(
  attachments: readonly ReportAttachmentMetadata[] | undefined,
  settings: ReportAiSettings
): ReportAttachmentMetadata[] {
  if (!attachments?.length) {
    return [];
  }

  return attachments
    .filter((attachment) => isEligibleReportImageAttachment(attachment, settings))
    .slice(0, settings.maxImages);
}
