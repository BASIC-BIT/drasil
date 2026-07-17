import { inject, injectable } from 'inversify';
import { Routes, type Client, type Message, type MessageCreateOptions } from 'discord.js';
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
import type { ServerSettings } from '../repositories/types';

const DISCORD_MESSAGE_CONTENT_LIMIT = 2000;
const CODE_BLOCK_CLOSING_MARKER = '\n```';
const EVIDENCE_TRUNCATION_NOTICE = '\n\n[Evidence text truncated to fit Discord message limits.]';

interface EvidenceThreadLike {
  send(options: MessageCreateOptions): Promise<Message>;
}

export interface PreserveMessageEvidenceInput {
  readonly sourceMessage: Message;
  readonly evidenceThreadId: string;
  readonly jobId: string;
  readonly itemId: string;
  readonly reason: string;
  readonly settings?: ServerSettings;
}

export interface PreserveMessageEvidenceResult {
  readonly preserved: boolean;
  readonly evidenceMessageId?: string;
  readonly reason?: string;
}

export interface DeleteMessageInput {
  readonly channelId: string;
  readonly messageId: string;
  readonly reason: string;
}

export interface BulkDeleteMessagesInput {
  readonly channelId: string;
  readonly messageIds: readonly string[];
  readonly reason: string;
}

export interface SourceMessageDeletionInput {
  readonly detectionEventId: string;
  readonly sourceMessage: Message;
  readonly evidenceThreadId: string | null | undefined;
  readonly action: DetectionMessageAction;
  readonly settings?: ServerSettings;
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
  preserveMessageEvidence(
    input: PreserveMessageEvidenceInput
  ): Promise<PreserveMessageEvidenceResult>;
  deleteMessage(input: DeleteMessageInput): Promise<void>;
  bulkDeleteMessages(input: BulkDeleteMessagesInput): Promise<void>;
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

    let evidenceMessage: Message;
    try {
      evidenceMessage = await this.preserveEvidence(input, evidenceThread);
    } catch (error) {
      const failureReason = this.formatFailureReason(error);
      await this.mergeDeletionMetadata(input.detectionEventId, {
        ...metadataBase,
        attempted: true,
        deleted: false,
        evidence_preserved: false,
        failure_reason: failureReason,
      });
      return {
        attempted: true,
        deleted: false,
        evidencePreserved: false,
        reason: failureReason,
      };
    }

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
      const failureReason = this.formatFailureReason(error);
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

  public async preserveMessageEvidence(
    input: PreserveMessageEvidenceInput
  ): Promise<PreserveMessageEvidenceResult> {
    const evidenceThread = await this.fetchEvidenceThread(input.evidenceThreadId);
    if (!evidenceThread) {
      return { preserved: false, reason: 'evidence_thread_unavailable' };
    }

    try {
      const evidenceMessage = await this.preserveCleanupEvidence(input, evidenceThread);
      return { preserved: true, evidenceMessageId: evidenceMessage.id };
    } catch (error) {
      return { preserved: false, reason: this.formatFailureReason(error) };
    }
  }

  public async deleteMessage(input: DeleteMessageInput): Promise<void> {
    await this.client.rest.delete(Routes.channelMessage(input.channelId, input.messageId), {
      reason: this.formatAuditReason(input.reason),
    });
  }

  public async bulkDeleteMessages(input: BulkDeleteMessagesInput): Promise<void> {
    const messageIds = [...new Set(input.messageIds)];
    if (messageIds.length < 2 || messageIds.length > 100) {
      throw new Error('Discord bulk deletion requires 2 to 100 unique message IDs.');
    }

    await this.client.rest.post(Routes.channelBulkDelete(input.channelId), {
      body: { messages: messageIds },
      reason: this.formatAuditReason(input.reason),
    });
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
      getReportAiSettings(input.settings)
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

  private async preserveCleanupEvidence(
    input: PreserveMessageEvidenceInput,
    evidenceThread: EvidenceThreadLike
  ): Promise<Message> {
    const attachments = messageAttachmentsToReportMetadata(input.sourceMessage);
    const eligibleImages = selectEligibleReportImageAttachments(
      attachments,
      getReportAiSettings(input.settings)
    );
    const imageFiles = await buildSpoilerImageAttachmentFileResult(eligibleImages, {
      logger: console,
    });

    return evidenceThread.send({
      content: this.buildCleanupEvidenceMessage(input, attachments, imageFiles.copiedAttachmentIds),
      files: imageFiles.files.length > 0 ? imageFiles.files : undefined,
      allowedMentions: { parse: [] },
    });
  }

  private buildCleanupEvidenceMessage(
    input: PreserveMessageEvidenceInput,
    attachments: readonly ReportAttachmentMetadata[],
    copiedAttachmentIds: ReadonlySet<string>
  ): string {
    const attachmentLines = attachments.length
      ? attachments.map((attachment) => {
          const copied = attachment.id && copiedAttachmentIds.has(attachment.id) ? ' copied' : '';
          return `- ${attachment.name ?? attachment.id ?? 'attachment'} (${attachment.contentType ?? 'unknown'}, ${attachment.size ?? 'unknown'} bytes)${copied}`;
        })
      : ['- none'];

    return this.truncateEvidenceMessage(
      [
        'Message preserved before moderator-requested deletion.',
        '',
        `Cleanup job: ${input.jobId}`,
        `Cleanup item: ${input.itemId}`,
        `Reason: ${input.reason}`,
        `Message ID: ${input.sourceMessage.id}`,
        `Channel ID: ${input.sourceMessage.channelId}`,
        `Author: ${input.sourceMessage.author.tag} (${input.sourceMessage.author.id})`,
        `Created: ${new Date(input.sourceMessage.createdTimestamp).toISOString()}`,
        `Edited: ${input.sourceMessage.editedTimestamp ? new Date(input.sourceMessage.editedTimestamp).toISOString() : 'never'}`,
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
      ].join('\n')
    );
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

    return this.truncateEvidenceMessage(
      [
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
      ].join('\n')
    );
  }

  private truncateEvidenceMessage(content: string): string {
    if (content.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      return content;
    }

    const maxContentLength = DISCORD_MESSAGE_CONTENT_LIMIT - EVIDENCE_TRUNCATION_NOTICE.length;
    let truncatedContent = content.slice(0, maxContentLength);
    if (this.hasUnclosedCodeBlock(truncatedContent)) {
      truncatedContent = `${truncatedContent.slice(
        0,
        maxContentLength - CODE_BLOCK_CLOSING_MARKER.length
      )}${CODE_BLOCK_CLOSING_MARKER}`;
    }

    return `${truncatedContent}${EVIDENCE_TRUNCATION_NOTICE}`;
  }

  private hasUnclosedCodeBlock(content: string): boolean {
    return (content.match(/```/g) ?? []).length % 2 === 1;
  }

  private formatFailureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private formatAuditReason(reason: string): string {
    return reason.trim().slice(0, 512) || 'Moderator-requested case message cleanup';
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
