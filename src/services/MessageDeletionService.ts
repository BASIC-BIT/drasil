import { inject, injectable } from 'inversify';
import type { Client, Message, MessageCreateOptions } from 'discord.js';
import { TYPES } from '../di/symbols';
import type { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import type { DetectionMessageAction } from './DetectionOrchestrator';
import {
  buildSpoilerImageAttachmentFileResult,
  messageAttachmentsToReportMetadata,
} from '../utils/reportAttachments';
import {
  getReportAiSettings,
  selectEligibleReportImageAttachments,
  type ReportAttachmentMetadata,
} from '../utils/reportAiSettings';

interface EvidenceThreadLike {
  send(options: MessageCreateOptions): Promise<Message>;
}

export interface SourceMessageDeletionInput {
  readonly detectionEventId: string;
  readonly sourceMessage: Message;
  readonly evidenceThreadId: string | null | undefined;
  readonly action: DetectionMessageAction;
}

export interface SourceMessageDeletionResult {
  readonly attempted: boolean;
  readonly deleted: boolean;
  readonly evidencePreserved: boolean;
  readonly reason?: string;
}

export interface IMessageDeletionService {
  preserveAndDeleteSourceMessage(
    input: SourceMessageDeletionInput
  ): Promise<SourceMessageDeletionResult>;
}

@injectable()
export class MessageDeletionService implements IMessageDeletionService {
  public constructor(
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.DetectionEventsRepository)
    private readonly detectionEventsRepository: IDetectionEventsRepository
  ) {}

  public async preserveAndDeleteSourceMessage(
    input: SourceMessageDeletionInput
  ): Promise<SourceMessageDeletionResult> {
    const metadataBase = this.buildMetadataBase(input);

    if (!input.evidenceThreadId) {
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: false,
        evidence_preserved: false,
        failure_reason: 'missing_evidence_thread',
      });
      return {
        attempted: true,
        deleted: false,
        evidencePreserved: false,
        reason: 'missing_evidence_thread',
      };
    }

    const evidenceThread = await this.fetchEvidenceThread(input.evidenceThreadId);
    if (!evidenceThread) {
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: false,
        evidence_preserved: false,
        failure_reason: 'evidence_thread_unavailable',
      });
      return {
        attempted: true,
        deleted: false,
        evidencePreserved: false,
        reason: 'evidence_thread_unavailable',
      };
    }

    const evidenceMessage = await this.preserveEvidence(input, evidenceThread);
    if (!input.sourceMessage.deletable) {
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: false,
        evidence_preserved: true,
        evidence_message_id: evidenceMessage.id,
        failure_reason: 'message_not_deletable',
      });
      return {
        attempted: true,
        deleted: false,
        evidencePreserved: true,
        reason: 'message_not_deletable',
      };
    }

    try {
      await input.sourceMessage.delete();
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: true,
        evidence_preserved: true,
        evidence_message_id: evidenceMessage.id,
        deleted_at: new Date().toISOString(),
      });
      return { attempted: true, deleted: true, evidencePreserved: true };
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : String(error);
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: false,
        evidence_preserved: true,
        evidence_message_id: evidenceMessage.id,
        failure_reason: failureReason,
      });
      return {
        attempted: true,
        deleted: false,
        evidencePreserved: true,
        reason: failureReason,
      };
    }
  }

  private buildMetadataBase(input: SourceMessageDeletionInput): Record<string, unknown> {
    return {
      source: input.action.source,
      scope: 'source_message',
      watchlist_entry_id: input.action.watchlistEntryId,
      watchlist_entry_label: input.action.watchlistEntryLabel,
      matched_term: input.action.matchedTerm,
      message_id: input.sourceMessage.id,
      channel_id: input.sourceMessage.channelId,
      author_id: input.sourceMessage.author.id,
      attempted_at: new Date().toISOString(),
    };
  }

  private async fetchEvidenceThread(threadId: string): Promise<EvidenceThreadLike | null> {
    const channel = await this.client.channels.fetch(threadId).catch(() => null);
    return this.isEvidenceThreadLike(channel) ? channel : null;
  }

  private isEvidenceThreadLike(channel: unknown): channel is EvidenceThreadLike {
    return Boolean(channel) && typeof (channel as { send?: unknown }).send === 'function';
  }

  private async preserveEvidence(
    input: SourceMessageDeletionInput,
    evidenceThread: EvidenceThreadLike
  ): Promise<Message> {
    const attachments = messageAttachmentsToReportMetadata(input.sourceMessage);
    const eligibleImages = selectEligibleReportImageAttachments(
      attachments,
      getReportAiSettings({})
    );
    const imageFiles = await buildSpoilerImageAttachmentFileResult(eligibleImages, {
      logger: console,
    });

    return evidenceThread.send({
      content: this.buildEvidenceMessage(input, attachments, imageFiles.copiedAttachmentIds),
      files: imageFiles.files.length > 0 ? imageFiles.files : undefined,
      allowedMentions: { parse: [] },
    });
  }

  private buildEvidenceMessage(
    input: SourceMessageDeletionInput,
    attachments: readonly ReportAttachmentMetadata[],
    copiedAttachmentIds: ReadonlySet<string>
  ): string {
    const attachmentLines = attachments.length
      ? attachments.map((attachment) => {
          const copied = attachment.id && copiedAttachmentIds.has(attachment.id) ? ' copied' : '';
          return `- ${attachment.name ?? attachment.id ?? 'attachment'} (${attachment.contentType ?? 'unknown'}, ${attachment.size ?? 'unknown'} bytes)${copied}`;
        })
      : ['- none'];

    return [
      'Source message preserved before configured deletion.',
      '',
      `Policy source: ${input.action.source}`,
      `Watchlist entry: ${input.action.watchlistEntryLabel} (${input.action.watchlistEntryId})`,
      `Matched term: ${input.action.matchedTerm}`,
      `Message ID: ${input.sourceMessage.id}`,
      `Channel ID: ${input.sourceMessage.channelId}`,
      `Author: ${input.sourceMessage.author.tag} (${input.sourceMessage.author.id})`,
      `Created: ${new Date(input.sourceMessage.createdTimestamp).toISOString()}`,
      '',
      'Message content:',
      '```text',
      this.formatCodeBlockText(input.sourceMessage.content || '[no text content]'),
      '```',
      '',
      'Attachments:',
      ...attachmentLines,
      '',
      'Spoilered image copies are attached when Discord still exposes eligible image data.',
    ].join('\n');
  }

  private formatCodeBlockText(content: string): string {
    return content.replace(/```/g, "'''").slice(0, 3500);
  }

  private async mergeDeletionMetadata(
    detectionEventId: string,
    deletionMetadata: Record<string, unknown>
  ): Promise<void> {
    const detectionEvent = await this.detectionEventsRepository.findById(detectionEventId);
    const metadata =
      detectionEvent?.metadata &&
      typeof detectionEvent.metadata === 'object' &&
      !Array.isArray(detectionEvent.metadata)
        ? { ...detectionEvent.metadata }
        : {};

    await this.detectionEventsRepository.updateMetadata(detectionEventId, {
      ...metadata,
      message_deletion: deletionMetadata,
    });
  }
}
