import { inject, injectable } from 'inversify';
import { Routes, SnowflakeUtil, type Client, type Message } from 'discord.js';
import { TYPES } from '../di/symbols';
import type { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import type { IMessageContextRepository } from '../repositories/MessageContextRepository';
import type { IMessageDeletionJobRepository } from '../repositories/MessageDeletionJobRepository';
import type { IServerRepository } from '../repositories/ServerRepository';
import type { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type { IMessageDeletionService } from './MessageDeletionService';
import {
  MessageDeletionCoverage,
  MessageDeletionDiscoverySource,
  MessageDeletionEvidenceStatus,
  MessageDeletionItemStatus,
  MessageDeletionJobStatus,
  MessageDeletionScope,
  VerificationStatus,
  type MessageContext,
  type MessageDeletionItem,
  type MessageDeletionItemCreate,
  type MessageDeletionJob,
  type MessageDeletionJobSummary,
  type MessageDeletionJobWithItems,
  type MessageDeletionPreviewResult,
  type ServerSettings,
} from '../repositories/types';

const SEARCH_PAGE_SIZE = 25;
const PREVIEW_LIMIT = 500;
const EXECUTION_LIMIT = 100;
const CONTENT_PREVIEW_LIMIT = 500;
const BULK_DELETE_LIMIT = 100;
const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

interface SearchMessage {
  id: string;
  channel_id: string;
  author: { id: string };
  content?: string;
  timestamp: string;
  edited_timestamp?: string | null;
  attachments?: readonly unknown[];
}

interface GuildMessageSearchResponse {
  total_results?: number;
  messages?: readonly (readonly SearchMessage[])[];
  doing_deep_historical_index?: boolean;
  code?: number;
  retry_after?: number;
}

interface MessageChannelLike {
  messages: { fetch(messageId: string): Promise<Message> };
}

export type MessageCleanupDeletionService = Pick<
  IMessageDeletionService,
  'preserveMessageEvidence' | 'deleteMessage' | 'bulkDeleteMessages'
>;

export interface MessageCleanupExecutionResult extends MessageDeletionJobSummary {
  jobId: string;
  alreadyCompleted: boolean;
}

interface DiscoveryResult {
  coverage: MessageDeletionCoverage;
  items: MessageDeletionItemCreate[];
  metadata: Record<string, string | number | boolean | null>;
}

interface PreparedDeletion {
  item: MessageDeletionItem;
  message: Message;
  evidenceMessageId: string;
}

@injectable()
export class MessageCleanupService {
  public constructor(
    @inject(TYPES.DiscordClient) private readonly client: Client,
    @inject(TYPES.MessageDeletionJobRepository)
    private readonly jobs: IMessageDeletionJobRepository,
    @inject(TYPES.VerificationEventRepository)
    private readonly verificationEvents: IVerificationEventRepository,
    @inject(TYPES.DetectionEventsRepository)
    private readonly detectionEvents: IDetectionEventsRepository,
    @inject(TYPES.MessageContextRepository)
    private readonly messageContexts: IMessageContextRepository,
    @inject(TYPES.ServerRepository) private readonly servers: IServerRepository,
    @inject(TYPES.MessageDeletionService)
    private readonly deletionService: MessageCleanupDeletionService,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async previewJob(jobId: string): Promise<MessageDeletionJobWithItems> {
    const current = await this.requireJob(jobId);
    await this.assertPendingCase(current);
    if (current.status === MessageDeletionJobStatus.READY) return current;
    if (current.status === MessageDeletionJobStatus.COMPLETED) {
      throw new Error('Completed message cleanup jobs cannot be previewed again.');
    }
    const claimed = await this.jobs.beginPreview(jobId);
    if (!claimed) throw new Error('Message cleanup job is not available for preview.');

    try {
      const previewedAt = this.now();
      const window = this.requestedWindow(claimed.scope, previewedAt);
      const discovery =
        claimed.scope === MessageDeletionScope.SOURCE_MESSAGE
          ? await this.discoverSource(claimed, previewedAt)
          : await this.discoverWindow(claimed, window.start, window.end, previewedAt);
      const preview: MessageDeletionPreviewResult = {
        coverage: discovery.coverage,
        requestedWindowStart: window.start,
        requestedWindowEnd: window.end,
        items: discovery.items,
        metadata: {
          ...discovery.metadata,
          preview_limit: PREVIEW_LIMIT,
          execution_limit: EXECUTION_LIMIT,
        },
      };
      await this.jobs.replacePreview(jobId, preview);
      return this.requireJob(jobId);
    } catch (error) {
      await this.jobs.fail(jobId, this.formatError(error));
      throw error;
    }
  }

  public async executeJob(jobId: string): Promise<MessageCleanupExecutionResult> {
    const current = await this.requireJob(jobId);
    if (current.status === MessageDeletionJobStatus.COMPLETED) {
      return { jobId, alreadyCompleted: true, ...this.summarize(current.items) };
    }
    await this.assertPendingCase(current);
    const execution =
      current.status === MessageDeletionJobStatus.EXECUTING
        ? current
        : await this.jobs.beginExecution(jobId);
    if (!execution) {
      throw new Error('Execution requires ready coverage and no more than 100 candidates.');
    }
    if (execution.items.length > EXECUTION_LIMIT) {
      throw new Error('Message cleanup execution cannot exceed 100 candidates.');
    }

    try {
      // A process exit bypasses this catch and leaves EXECUTING state for stale-request recovery.
      const server = await this.servers.findById(execution.server_id);
      const prepared: PreparedDeletion[] = [];
      for (const item of execution.items) {
        if (item.status !== MessageDeletionItemStatus.PENDING) continue;
        const candidate = await this.prepareDeletion(execution, item, server?.settings);
        if (candidate) prepared.push(candidate);
      }
      await this.deletePrepared(execution, prepared);
      const refreshed = await this.requireJob(jobId);
      const summary = this.summarize(refreshed.items);
      await this.jobs.complete(jobId, summary);
      return { jobId, alreadyCompleted: false, ...summary };
    } catch (error) {
      await this.jobs.fail(jobId, this.formatError(error));
      throw error;
    }
  }

  private async requireJob(id: string): Promise<MessageDeletionJobWithItems> {
    const job = await this.jobs.findById(id);
    if (!job) throw new Error('Message cleanup job was not found.');
    return job;
  }

  private async assertPendingCase(job: MessageDeletionJob): Promise<void> {
    const event = await this.verificationEvents.findById(job.verification_event_id);
    if (
      !event ||
      event.server_id !== job.server_id ||
      event.user_id !== job.user_id ||
      event.status !== VerificationStatus.PENDING ||
      event.private_evidence_thread_id !== job.evidence_thread_id
    ) {
      throw new Error('Message cleanup requires the matching pending case and evidence thread.');
    }
  }

  private requestedWindow(
    scope: MessageDeletionScope,
    end: Date
  ): { start: Date | null; end: Date } {
    const duration =
      scope === MessageDeletionScope.LAST_HOUR
        ? 60 * 60 * 1000
        : scope === MessageDeletionScope.LAST_DAY
          ? 24 * 60 * 60 * 1000
          : scope === MessageDeletionScope.LAST_7_DAYS
            ? 7 * 24 * 60 * 60 * 1000
            : null;
    return { start: duration === null ? null : new Date(end.getTime() - duration), end };
  }

  private async discoverSource(
    job: MessageDeletionJob,
    previewedAt: Date
  ): Promise<DiscoveryResult> {
    const verification = await this.verificationEvents.findById(job.verification_event_id);
    const detection = verification?.detection_event_id
      ? await this.detectionEvents.findById(verification.detection_event_id)
      : null;
    if (
      !detection ||
      detection.server_id !== job.server_id ||
      detection.user_id !== job.user_id ||
      !detection.message_id ||
      !detection.channel_id
    ) {
      return this.blocked(
        MessageDeletionCoverage.UNAVAILABLE,
        'source_message_metadata_unavailable'
      );
    }
    const live = await this.fetchLiveMessage(detection.channel_id, detection.message_id);
    if (live.kind === 'message') {
      if (live.message.author.id !== job.user_id) {
        return this.blocked(MessageDeletionCoverage.UNAVAILABLE, 'source_message_author_mismatch');
      }
      return {
        coverage: MessageDeletionCoverage.READY,
        items: [
          this.messageItem(
            live.message,
            MessageDeletionDiscoverySource.SOURCE_MESSAGE,
            previewedAt
          ),
        ],
        metadata: { discovery: 'source_message' },
      };
    }
    if (live.kind === 'denied') return this.blocked(MessageDeletionCoverage.DENIED, live.reason);
    if (live.kind === 'error')
      return this.blocked(MessageDeletionCoverage.UNAVAILABLE, live.reason);

    return this.blocked(MessageDeletionCoverage.UNAVAILABLE, 'source_message_missing');
  }

  private blocked(coverage: MessageDeletionCoverage, reason: string): DiscoveryResult {
    return { coverage, items: [], metadata: { discovery: 'source_message', reason } };
  }

  private async discoverWindow(
    job: MessageDeletionJob,
    start: Date | null,
    end: Date,
    previewedAt: Date
  ): Promise<DiscoveryResult> {
    if (!start) throw new Error('Windowed cleanup requires a start time.');
    try {
      const result = await this.search(job, start, end, previewedAt);
      if (result.coverage !== MessageDeletionCoverage.INDEXING) return result;
      const fallback = await this.contextFallback(job, start, end, previewedAt);
      return fallback.length
        ? {
            ...result,
            items: fallback,
            metadata: { ...result.metadata, fallback: 'message_context' },
          }
        : result;
    } catch (error) {
      const failure = this.classifyError(error);
      const fallback = await this.contextFallback(job, start, end, previewedAt);
      return fallback.length
        ? {
            coverage: MessageDeletionCoverage.PARTIAL,
            items: fallback,
            metadata: {
              discovery: 'message_context',
              search_failure: failure.coverage,
              reason: failure.reason,
            },
          }
        : {
            coverage: failure.coverage,
            items: [],
            metadata: { discovery: 'discord_search', reason: failure.reason },
          };
    }
  }

  private async search(
    job: MessageDeletionJob,
    start: Date,
    end: Date,
    previewedAt: Date
  ): Promise<DiscoveryResult> {
    const found = new Map<string, MessageDeletionItemCreate>();
    let offset = 0;
    let total = 0;
    let indexing = false;
    let reachedEnd = false;
    while (found.size < PREVIEW_LIMIT && offset < PREVIEW_LIMIT) {
      const query = new URLSearchParams({
        author_id: job.user_id,
        min_id: SnowflakeUtil.generate({ timestamp: start }).toString(),
        max_id: SnowflakeUtil.generate({ timestamp: end }).toString(),
        limit: String(SEARCH_PAGE_SIZE),
        offset: String(offset),
      });
      const response = (await this.client.rest.get(Routes.guildMessagesSearch(job.server_id), {
        query,
      })) as GuildMessageSearchResponse;
      if (response.code === 110000 || response.retry_after !== undefined) {
        return {
          coverage: MessageDeletionCoverage.INDEXING,
          items: [...found.values()],
          metadata: { discovery: 'discord_search', retry_after: response.retry_after ?? null },
        };
      }
      total = Math.max(total, response.total_results ?? 0);
      indexing ||= response.doing_deep_historical_index === true;
      const groups = response.messages ?? [];
      for (const message of groups.flat()) {
        const createdAt = new Date(message.timestamp);
        if (
          message.author.id === job.user_id &&
          createdAt >= start &&
          createdAt <= end &&
          !found.has(message.id)
        ) {
          found.set(message.id, this.searchItem(message, previewedAt));
          if (found.size === PREVIEW_LIMIT) break;
        }
      }
      if (groups.length === 0) {
        reachedEnd = true;
        break;
      }
      if (groups.length < SEARCH_PAGE_SIZE) {
        reachedEnd = true;
        break;
      }
      offset += SEARCH_PAGE_SIZE;
    }
    const items = [...found.values()].sort(
      (a, b) => a.messageCreatedAt.getTime() - b.messageCreatedAt.getTime()
    );
    return {
      coverage: indexing
        ? MessageDeletionCoverage.INDEXING
        : !reachedEnd || total > EXECUTION_LIMIT || items.length > EXECUTION_LIMIT
          ? MessageDeletionCoverage.TOO_MANY
          : MessageDeletionCoverage.READY,
      items,
      metadata: {
        discovery: 'discord_search',
        total_results: total,
        frozen_candidates: items.length,
        truncated: !reachedEnd || total > PREVIEW_LIMIT,
      },
    };
  }

  private async contextFallback(
    job: MessageDeletionJob,
    start: Date,
    end: Date,
    previewedAt: Date
  ): Promise<MessageDeletionItemCreate[]> {
    const contexts = await this.messageContexts.findRecentByServerAndUser(
      job.server_id,
      job.user_id
    );
    return contexts
      .filter((item) => item.channel_id && item.created_at >= start && item.created_at <= end)
      .map((item) => this.contextItem(item, previewedAt));
  }

  private async prepareDeletion(
    job: MessageDeletionJobWithItems,
    item: MessageDeletionItem,
    settings?: ServerSettings
  ): Promise<PreparedDeletion | null> {
    const attemptedAt = this.now();
    const live = await this.fetchLiveMessage(item.channel_id, item.message_id);
    if (live.kind !== 'message') {
      const status =
        live.kind === 'missing'
          ? MessageDeletionItemStatus.ALREADY_MISSING
          : live.kind === 'denied'
            ? MessageDeletionItemStatus.PERMISSION_DENIED
            : MessageDeletionItemStatus.DELETE_FAILED;
      await this.jobs.updateItemOutcome(item.id, {
        status,
        evidenceStatus: item.evidence_status,
        attemptedAt,
        failureReason: live.kind === 'missing' ? null : live.reason,
      });
      return null;
    }
    if (this.changed(item, live.message)) {
      await this.jobs.updateItemOutcome(item.id, {
        status: MessageDeletionItemStatus.CHANGED_SINCE_PREVIEW,
        evidenceStatus: item.evidence_status,
        attemptedAt,
        failureReason: 'message_changed_since_preview',
      });
      return null;
    }

    let evidenceMessageId = item.evidence_message_id;
    if (item.evidence_status !== MessageDeletionEvidenceStatus.PRESERVED || !evidenceMessageId) {
      try {
        const result = await this.deletionService.preserveMessageEvidence({
          sourceMessage: live.message,
          evidenceThreadId: job.evidence_thread_id,
          jobId: job.id,
          itemId: item.id,
          reason: job.reason,
          settings,
        });
        if (!result.preserved || !result.evidenceMessageId) {
          throw new Error(result.reason ?? 'evidence_preservation_failed');
        }
        evidenceMessageId = result.evidenceMessageId;
        await this.jobs.markItemEvidencePreserved(item.id, evidenceMessageId, attemptedAt);
      } catch (error) {
        await this.jobs.updateItemOutcome(item.id, {
          status: MessageDeletionItemStatus.EVIDENCE_FAILED,
          evidenceStatus: MessageDeletionEvidenceStatus.FAILED,
          attemptedAt,
          failureReason: this.formatError(error),
        });
        return null;
      }
    }
    return { item, message: live.message, evidenceMessageId };
  }

  private async deletePrepared(
    job: MessageDeletionJobWithItems,
    prepared: readonly PreparedDeletion[]
  ): Promise<void> {
    const groups = new Map<string, PreparedDeletion[]>();
    const singles: PreparedDeletion[] = [];
    const now = this.now();
    for (const candidate of prepared) {
      if (
        !candidate.item.bulk_delete_eligible ||
        !this.bulkEligible(new Date(candidate.message.createdTimestamp), now)
      ) {
        singles.push(candidate);
        continue;
      }
      const group = groups.get(candidate.item.channel_id) ?? [];
      group.push(candidate);
      groups.set(candidate.item.channel_id, group);
    }
    for (const group of groups.values()) {
      if (group.length < 2) {
        singles.push(...group);
        continue;
      }
      for (let index = 0; index < group.length; index += BULK_DELETE_LIMIT) {
        const batch = group.slice(index, index + BULK_DELETE_LIMIT);
        if (batch.length < 2) singles.push(...batch);
        else await this.deleteBatch(job, batch);
      }
    }
    for (const candidate of singles) await this.deleteSingle(job, candidate);
  }

  private async deleteBatch(
    job: MessageDeletionJob,
    batch: readonly PreparedDeletion[]
  ): Promise<void> {
    try {
      await this.deletionService.bulkDeleteMessages({
        channelId: batch[0].item.channel_id,
        messageIds: batch.map((item) => item.item.message_id),
        reason: job.reason,
      });
    } catch (error) {
      await Promise.all(batch.map((item) => this.recordDeleteFailure(item, error)));
      return;
    }
    await Promise.all(batch.map((item) => this.recordDeleted(item)));
  }

  private async deleteSingle(job: MessageDeletionJob, candidate: PreparedDeletion): Promise<void> {
    try {
      await this.deletionService.deleteMessage({
        channelId: candidate.item.channel_id,
        messageId: candidate.item.message_id,
        reason: job.reason,
      });
    } catch (error) {
      await this.recordDeleteFailure(candidate, error);
      return;
    }
    await this.recordDeleted(candidate);
  }

  private async recordDeleted(candidate: PreparedDeletion): Promise<void> {
    const completedAt = this.now();
    await this.jobs.updateItemOutcome(candidate.item.id, {
      status: MessageDeletionItemStatus.DELETED,
      evidenceStatus: MessageDeletionEvidenceStatus.PRESERVED,
      evidenceMessageId: candidate.evidenceMessageId,
      attemptedAt: completedAt,
      deletedAt: completedAt,
      completedAt,
    });
  }

  private async recordDeleteFailure(candidate: PreparedDeletion, error: unknown): Promise<void> {
    const failure = this.classifyError(error);
    await this.jobs.updateItemOutcome(candidate.item.id, {
      status:
        failure.coverage === MessageDeletionCoverage.DENIED
          ? MessageDeletionItemStatus.PERMISSION_DENIED
          : MessageDeletionItemStatus.DELETE_FAILED,
      evidenceStatus: MessageDeletionEvidenceStatus.PRESERVED,
      evidenceMessageId: candidate.evidenceMessageId,
      attemptedAt: this.now(),
      failureReason: failure.reason,
    });
  }

  private async fetchLiveMessage(
    channelId: string,
    messageId: string
  ): Promise<
    | { kind: 'message'; message: Message }
    | { kind: 'missing' }
    | { kind: 'denied' | 'error'; reason: string }
  > {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!this.hasMessages(channel))
        return { kind: 'error', reason: 'message_channel_unavailable' };
      return { kind: 'message', message: await channel.messages.fetch(messageId) };
    } catch (error) {
      if (this.errorCode(error) === 10008) return { kind: 'missing' };
      const failure = this.classifyError(error);
      return {
        kind: failure.coverage === MessageDeletionCoverage.DENIED ? 'denied' : 'error',
        reason: failure.reason,
      };
    }
  }

  private hasMessages(channel: unknown): channel is MessageChannelLike {
    return (
      typeof (channel as { messages?: { fetch?: unknown } } | null)?.messages?.fetch === 'function'
    );
  }

  private messageItem(
    message: Message,
    source: MessageDeletionDiscoverySource,
    previewedAt: Date
  ): MessageDeletionItemCreate {
    const createdAt = new Date(message.createdTimestamp);
    return {
      messageId: message.id,
      channelId: message.channelId,
      authorId: message.author.id,
      messageCreatedAt: createdAt,
      messageEditedAt: message.editedAt,
      contentPreview: this.truncate(message.content),
      attachmentCount: message.attachments.size,
      discoverySource: source,
      bulkDeleteEligible: this.bulkEligible(createdAt, previewedAt),
    };
  }

  private searchItem(message: SearchMessage, previewedAt: Date): MessageDeletionItemCreate {
    const createdAt = new Date(message.timestamp);
    return {
      messageId: message.id,
      channelId: message.channel_id,
      authorId: message.author.id,
      messageCreatedAt: createdAt,
      messageEditedAt: message.edited_timestamp ? new Date(message.edited_timestamp) : null,
      contentPreview: this.truncate(message.content ?? ''),
      attachmentCount: message.attachments?.length ?? 0,
      discoverySource: MessageDeletionDiscoverySource.DISCORD_SEARCH,
      bulkDeleteEligible: this.bulkEligible(createdAt, previewedAt),
    };
  }

  private contextItem(context: MessageContext, previewedAt: Date): MessageDeletionItemCreate {
    const attachmentCount = context.content_features.attachment_count;
    return {
      messageId: context.message_id,
      channelId: context.channel_id as string,
      authorId: context.user_id,
      messageCreatedAt: context.created_at,
      messageEditedAt: null,
      contentPreview: this.truncate(context.content_preview),
      attachmentCount: typeof attachmentCount === 'number' ? attachmentCount : 0,
      discoverySource: MessageDeletionDiscoverySource.MESSAGE_CONTEXT,
      bulkDeleteEligible: this.bulkEligible(context.created_at, previewedAt),
    };
  }

  private changed(item: MessageDeletionItem, message: Message): boolean {
    return (
      message.author.id !== item.author_id ||
      (item.message_edited_at?.getTime() ?? null) !== message.editedTimestamp
    );
  }

  private bulkEligible(createdAt: Date, now: Date): boolean {
    return now.getTime() - createdAt.getTime() < BULK_DELETE_MAX_AGE_MS;
  }

  private summarize(items: readonly MessageDeletionItem[]): MessageDeletionJobSummary {
    return {
      preservedCount: items.filter(
        (item) => item.evidence_status === MessageDeletionEvidenceStatus.PRESERVED
      ).length,
      deletedCount: items.filter((item) => item.status === MessageDeletionItemStatus.DELETED)
        .length,
      alreadyMissingCount: items.filter(
        (item) => item.status === MessageDeletionItemStatus.ALREADY_MISSING
      ).length,
      changedCount: items.filter(
        (item) => item.status === MessageDeletionItemStatus.CHANGED_SINCE_PREVIEW
      ).length,
      evidenceFailedCount: items.filter(
        (item) => item.status === MessageDeletionItemStatus.EVIDENCE_FAILED
      ).length,
      deleteFailedCount: items.filter(
        (item) => item.status === MessageDeletionItemStatus.DELETE_FAILED
      ).length,
      permissionDeniedCount: items.filter(
        (item) => item.status === MessageDeletionItemStatus.PERMISSION_DENIED
      ).length,
    };
  }

  private classifyError(error: unknown): {
    coverage:
      | MessageDeletionCoverage.DENIED
      | MessageDeletionCoverage.INDEXING
      | MessageDeletionCoverage.UNAVAILABLE;
    reason: string;
  } {
    const code = this.errorCode(error);
    const status = this.errorStatus(error);
    if (code === 110000 || status === 202) {
      return { coverage: MessageDeletionCoverage.INDEXING, reason: 'discord_search_indexing' };
    }
    if (code === 50001 || code === 50013 || status === 401 || status === 403) {
      return { coverage: MessageDeletionCoverage.DENIED, reason: 'discord_permission_denied' };
    }
    return { coverage: MessageDeletionCoverage.UNAVAILABLE, reason: this.formatError(error) };
  }

  private errorCode(error: unknown): number | null {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'number' ? code : typeof code === 'string' ? Number(code) : null;
  }

  private errorStatus(error: unknown): number | null {
    const source = error as { status?: unknown; statusCode?: unknown } | null;
    const value = source?.status ?? source?.statusCode;
    return typeof value === 'number' ? value : null;
  }

  private truncate(value: string): string {
    return value.slice(0, CONTENT_PREVIEW_LIMIT);
  }

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
