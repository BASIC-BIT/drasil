import type {
  ReportEvidenceRef,
  ReportEvidenceSource,
  ReportSubjectClues,
} from '@drasil/application';
import type { MessageCreateOptions } from 'discord.js';
import {
  selectEligibleReportImageAttachments,
  isCurrentReportImageSource,
  type ReportAiSettings,
  type ReportAttachmentMetadata,
} from './reportAiSettings';

type SpoilerAttachmentFile = NonNullable<MessageCreateOptions['files']>[number];

interface MessageAttachmentLike {
  readonly id?: string;
  readonly name?: string | null;
  readonly url?: string;
  readonly proxyURL?: string;
  readonly contentType?: string | null;
  readonly size?: number;
}

interface MessageAttachmentCollectionLike {
  readonly map?: <T>(callback: (attachment: MessageAttachmentLike) => T) => T[];
  readonly values?: () => Iterable<MessageAttachmentLike>;
}

interface MessageWithAttachmentsLike {
  readonly attachments?: MessageAttachmentCollectionLike;
}

interface SpoilerImageFileLogger {
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

interface SpoilerImageFileOptions {
  readonly fetchImage?: (url: string) => Promise<Pick<Response, 'ok' | 'arrayBuffer'>>;
  readonly logger?: SpoilerImageFileLogger;
}

export function messageAttachmentsToReportMetadata(
  message: MessageWithAttachmentsLike
): ReportAttachmentMetadata[] {
  return getMessageAttachments(message.attachments).map((attachment) => ({
    id: attachment.id,
    name: attachment.name ?? undefined,
    url: attachment.url,
    proxyUrl: attachment.proxyURL,
    contentType: attachment.contentType ?? undefined,
    size: attachment.size,
  }));
}

export function selectEligibleMessageReportImageAttachments(
  message: MessageWithAttachmentsLike,
  settings: ReportAiSettings
): ReportAttachmentMetadata[] {
  return selectEligibleReportImageAttachments(
    messageAttachmentsToReportMetadata(message),
    settings
  );
}

function getMessageAttachments(
  attachments: MessageAttachmentCollectionLike | undefined
): MessageAttachmentLike[] {
  if (!attachments) {
    return [];
  }

  if (typeof attachments.map === 'function') {
    return attachments.map((attachment) => attachment);
  }

  if (typeof attachments.values === 'function') {
    return [...attachments.values()];
  }

  return [];
}

export async function buildSpoilerImageAttachmentFiles(
  attachments: readonly ReportAttachmentMetadata[],
  options: SpoilerImageFileOptions = {}
): Promise<SpoilerAttachmentFile[]> {
  return (await buildSpoilerImageAttachmentFileResult(attachments, options)).files;
}

export async function buildSpoilerImageAttachmentFileResult(
  attachments: readonly ReportAttachmentMetadata[],
  options: SpoilerImageFileOptions = {}
): Promise<{ readonly files: SpoilerAttachmentFile[]; readonly copiedAttachmentIds: Set<string> }> {
  const fetchImage = options.fetchImage ?? fetch;
  const files: SpoilerAttachmentFile[] = [];
  const copiedAttachmentIds = new Set<string>();

  for (const attachment of attachments) {
    const url = attachment.proxyUrl ?? attachment.url;
    if (!url) {
      continue;
    }

    try {
      const response = await fetchImage(url);
      if (!response.ok) {
        options.logger?.warn(`Failed to fetch report image attachment ${attachment.id ?? url}`);
        continue;
      }

      files.push({
        attachment: Buffer.from(await response.arrayBuffer()),
        name: toSpoilerFilename(attachment.name ?? attachment.id ?? 'image'),
      });
      if (attachment.id) {
        copiedAttachmentIds.add(attachment.id);
      }
    } catch (error) {
      options.logger?.warn(
        `Failed to copy report image attachment ${attachment.id ?? url}:`,
        error
      );
    }
  }

  return { files, copiedAttachmentIds };
}

export function toSpoilerFilename(filename: string): string {
  const sanitized = filename.replace(/[\\/:*?"<>|]/g, '_').trim() || 'image';
  return sanitized.startsWith('SPOILER_') ? sanitized : `SPOILER_${sanitized}`;
}

export function prepareReportEvidenceSource(input: {
  message: MessageWithAttachmentsLike & { readonly id: string; readonly content?: string };
  ref: ReportEvidenceRef;
  attachmentId?: string;
  settings: ReportAiSettings;
  anchors?: readonly ReportSubjectClues[];
}): ReportEvidenceSource {
  const { message, ref, settings } = input;
  const unavailable: ReportEvidenceSource = {
    ref,
    content: { kind: 'unavailable', reason: 'evidence_unavailable' },
  };
  const excluded: ReportEvidenceSource = {
    ref,
    content: { kind: 'unavailable', reason: 'excluded' },
  };
  if (message.id !== ref.messageId) return unavailable;
  if (!settings.enabled) return excluded;
  if (ref.kind === 'text') {
    if (!settings.analyzeText) return excluded;
    return message.content?.trim()
      ? {
          ref,
          content: { kind: 'text', text: message.content },
          ...(input.anchors ? { anchors: input.anchors } : {}),
        }
      : unavailable;
  }
  if (!settings.analyzeImages || settings.maxImages < 1) return excluded;
  const attachment = messageAttachmentsToReportMetadata(message).find(
    (item) => item.id === input.attachmentId
  );
  if (!attachment) return unavailable;
  if (
    (attachment.contentType &&
      !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(
        attachment.contentType.toLowerCase()
      )) ||
    (typeof attachment.size === 'number' && attachment.size > settings.maxImageBytes)
  )
    return excluded;
  if (
    !attachment.id ||
    !attachment.url?.trim() ||
    !attachment.contentType ||
    typeof attachment.size !== 'number'
  )
    return unavailable;
  if (
    !selectEligibleMessageReportImageAttachments(message, settings).some(
      (item) => item.id === attachment.id
    )
  )
    return excluded;
  const image = {
    kind: 'image' as const,
    attachmentId: attachment.id,
    url: attachment.url,
    contentType: attachment.contentType,
    size: attachment.size,
  };
  return isCurrentReportImageSource(image, settings.maxImageBytes)
    ? { ref, content: image, ...(input.anchors ? { anchors: input.anchors } : {}) }
    : unavailable;
}
