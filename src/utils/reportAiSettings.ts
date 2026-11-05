import type { ServerSettings } from '../repositories/types';

export const REPORT_AI_TRIAGE_ENABLED_SETTING_KEY = 'report_ai_triage_enabled';
export const REPORT_AI_ANALYZE_TEXT_SETTING_KEY = 'report_ai_analyze_text';
export const REPORT_AI_ANALYZE_IMAGES_SETTING_KEY = 'report_ai_analyze_images';
export const REPORT_AI_MAX_ACTION_SETTING_KEY = 'report_ai_max_action';
export const REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY = 'report_ai_open_case_threshold';
export const REPORT_AI_MAX_IMAGES_SETTING_KEY = 'report_ai_max_images';
export const REPORT_AI_MAX_IMAGE_BYTES_SETTING_KEY = 'report_ai_max_image_bytes';

export const REPORT_AI_MAX_ACTIONS = ['off', 'hints', 'open_case'] as const;
export type ReportAiMaxAction = (typeof REPORT_AI_MAX_ACTIONS)[number];

export interface ReportAiSettings {
  enabled: boolean;
  analyzeText: boolean;
  analyzeImages: boolean;
  maxAction: ReportAiMaxAction;
  openCaseThreshold: number;
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
export const DEFAULT_REPORT_AI_TRIAGE_ENABLED = true;
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
  return {
    enabled: readBoolean(
      settings[REPORT_AI_TRIAGE_ENABLED_SETTING_KEY],
      DEFAULT_REPORT_AI_TRIAGE_ENABLED
    ),
    analyzeText: readBoolean(settings[REPORT_AI_ANALYZE_TEXT_SETTING_KEY], true),
    analyzeImages: readBoolean(settings[REPORT_AI_ANALYZE_IMAGES_SETTING_KEY], true),
    maxAction: readReportAiMaxAction(settings[REPORT_AI_MAX_ACTION_SETTING_KEY]),
    openCaseThreshold: readNumber(
      settings[REPORT_AI_OPEN_CASE_THRESHOLD_SETTING_KEY],
      DEFAULT_REPORT_AI_OPEN_CASE_THRESHOLD,
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

function readReportAiMaxAction(value: unknown): ReportAiMaxAction {
  return isReportAiMaxAction(value) ? value : 'hints';
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

/** The caller must refresh through the original authorized Discord message, never this URL. */
export function isCurrentReportImageSource(
  input: {
    url: string;
    attachmentId: string;
    contentType: string;
    size: number;
  },
  maxImageBytes = MAX_REPORT_AI_MAX_IMAGE_BYTES
): boolean {
  if (
    !Number.isSafeInteger(input.size) ||
    input.size < 0 ||
    input.size > maxImageBytes ||
    !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
      input.contentType.toLowerCase()
    )
  )
    return false;
  try {
    const url = new URL(input.url);
    const path = url.pathname.split('/');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) ||
      path.length !== 5 ||
      path[1] !== 'attachments' ||
      !path[2] ||
      path[3] !== input.attachmentId ||
      !path[4]
    )
      return false;
    const expires = url.searchParams.get('ex');
    return (
      expires === null ||
      (/^[a-f0-9]{1,16}$/i.test(expires) && parseInt(expires, 16) * 1000 > Date.now())
    );
  } catch {
    return false;
  }
}
