import type { MessageCreateOptions } from 'discord.js';
import {
  selectEligibleReportImageAttachments,
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
