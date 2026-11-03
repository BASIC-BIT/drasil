import { createHash } from 'node:crypto';
import type { Message } from 'discord.js';
import {
  ReportIntakeEvidenceKind,
  type ReportEvidenceBatch,
  type ReportIntake,
  type ReportIntakeEvidence,
} from '../repositories/types';
import { processingMetadata } from '../repositories/reportIntakeProcessing';
import { messageAttachmentsToReportMetadata } from './reportAttachments';
import { getReportAiSettings, isEligibleReportImageAttachment } from './reportAiSettings';

export function buildReportEvidenceBatch(
  message: Message,
  intake: ReportIntake,
  operation: 'upsert' | 'delete'
): ReportEvidenceBatch {
  const attachments = messageAttachmentsToReportMetadata(message)
    .map((attachment) => ({
      id: attachment.id ?? null,
      name: attachment.name ?? null,
      url: attachment.url ?? null,
      proxyUrl: attachment.proxyUrl ?? null,
      contentType: attachment.contentType ?? null,
      size: attachment.size ?? null,
    }))
    .sort((left, right) => (left.id ?? left.url ?? '').localeCompare(right.id ?? right.url ?? ''));
  const sourceVersion = message.editedTimestamp ?? message.createdTimestamp;
  const sourceFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        id: message.id,
        channelId: message.channelId,
        authorId: message.author.id,
        sourceVersion,
        content: message.content,
        attachments: attachments.map(({ id, name, contentType, size, url }) => ({
          id,
          name,
          contentType,
          size,
          url: id ? null : url,
        })),
      })
    )
    .digest('hex');
  const evidence: ReportEvidenceBatch['evidence'] = [];
  if (operation === 'upsert') {
    if (message.content.trim())
      evidence.push({
        kind:
          message.author.id === intake.reporter_id
            ? ReportIntakeEvidenceKind.REPORTER_TEXT
            : ReportIntakeEvidenceKind.ADMIN_NOTE,
        content: message.content,
        metadata: { author_id: message.author.id },
      });
    // Ingestion retains all images; the worker applies provider image and byte budgets later.
    const imageSettings = {
      ...getReportAiSettings(),
      maxImages: Number.MAX_SAFE_INTEGER,
      maxImageBytes: Number.MAX_SAFE_INTEGER,
      analyzeImages: true,
    };
    for (const attachment of attachments) {
      if (
        !isEligibleReportImageAttachment(
          {
            ...attachment,
            id: attachment.id ?? undefined,
            name: attachment.name ?? undefined,
            url: attachment.url ?? undefined,
            proxyUrl: attachment.proxyUrl ?? undefined,
            contentType: attachment.contentType ?? undefined,
            size: attachment.size ?? undefined,
          },
          imageSettings
        )
      )
        continue;
      evidence.push({
        kind: ReportIntakeEvidenceKind.SCREENSHOT,
        attachmentId: attachment.id,
        metadata: { ...attachment, author_id: message.author.id },
      });
    }
  }
  return {
    intakeId: intake.id,
    sourceMessageId: message.id,
    sourceChannelId: message.channelId,
    sourceAuthorId: message.author.id,
    sourceVersion,
    sourceFingerprint,
    observedAt: new Date(),
    editedAt: message.editedTimestamp ? new Date(message.editedTimestamp) : null,
    operation,
    availability: 'available',
    evidence,
  };
}

export function activeReportEvidence(
  intake: ReportIntake,
  evidence: ReportIntakeEvidence[]
): ReportIntakeEvidence[] {
  const { analysis } = processingMetadata(intake);
  return evidence.filter((row) => {
    if (!row.source_message_id) return true;
    const source = Object.prototype.hasOwnProperty.call(analysis.sources, row.source_message_id)
      ? analysis.sources[row.source_message_id]
      : undefined;
    if (!source) return true;
    const metadata = row.metadata;
    return (
      source.operation !== 'delete' &&
      source.availability === 'available' &&
      metadata !== null &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      metadata.sourceVersion === source.sourceVersion &&
      metadata.sourceFingerprint === source.sourceFingerprint
    );
  });
}
