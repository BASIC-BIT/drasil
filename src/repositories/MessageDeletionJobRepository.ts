import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  MessageDeletionCoverage,
  MessageDeletionBanStatus,
  MessageDeletionCaseFinalizationStatus,
  MessageDeletionEvidenceStatus,
  MessageDeletionItem,
  MessageDeletionItemOutcome,
  MessageDeletionJob,
  MessageDeletionJobCreate,
  MessageDeletionJobStatus,
  MessageDeletionJobSummary,
  MessageDeletionJobWithItems,
  MessageDeletionPreviewResult,
} from './types';

export interface IMessageDeletionJobRepository {
  create(data: MessageDeletionJobCreate): Promise<MessageDeletionJob>;
  findById(id: string): Promise<MessageDeletionJobWithItems | null>;
  beginPreview(id: string): Promise<MessageDeletionJob | null>;
  replacePreview(id: string, preview: MessageDeletionPreviewResult): Promise<MessageDeletionJob>;
  beginExecution(id: string): Promise<MessageDeletionJobWithItems | null>;
  markItemEvidencePreserved(
    itemId: string,
    evidenceMessageId: string,
    preservedAt?: Date
  ): Promise<MessageDeletionItem | null>;
  updateBanStatus(id: string, status: MessageDeletionBanStatus): Promise<MessageDeletionJob | null>;
  updateCaseFinalizationStatus(
    id: string,
    status: MessageDeletionCaseFinalizationStatus
  ): Promise<MessageDeletionJob | null>;
  updateItemOutcome(
    itemId: string,
    outcome: MessageDeletionItemOutcome
  ): Promise<MessageDeletionItem | null>;
  complete(id: string, summary: MessageDeletionJobSummary): Promise<MessageDeletionJob | null>;
  fail(id: string, error: string): Promise<MessageDeletionJob | null>;
}

@injectable()
export class MessageDeletionJobRepository implements IMessageDeletionJobRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(data: MessageDeletionJobCreate): Promise<MessageDeletionJob> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        insert into message_deletion_jobs (
          server_id,
          user_id,
          verification_event_id,
          requested_by,
          actor_surface,
          mode,
          scope,
          reason,
          evidence_thread_id,
          metadata
        ) values (
          ${data.serverId},
          ${data.userId},
          ${data.verificationEventId}::uuid,
          ${data.requestedBy},
          ${data.actorSurface},
          ${data.mode}::message_deletion_job_mode,
          ${data.scope}::message_deletion_scope,
          ${data.reason},
          ${data.evidenceThreadId},
          ${JSON.stringify(data.metadata ?? {})}::jsonb
        )
        returning *
      `;
      if (!rows[0]) {
        throw new Error('Failed to create message deletion job.');
      }
      return rows[0];
    } catch (error) {
      this.handleError(error, 'createMessageDeletionJob');
    }
  }

  public async findById(id: string): Promise<MessageDeletionJobWithItems | null> {
    try {
      const jobs = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        select *
        from message_deletion_jobs
        where id = ${id}::uuid
        limit 1
      `;
      if (!jobs[0]) {
        return null;
      }
      const items = await this.prisma.$queryRaw<MessageDeletionItem[]>`
        select *
        from message_deletion_items
        where job_id = ${id}::uuid
        order by message_created_at asc, message_id asc
      `;
      return { ...jobs[0], items };
    } catch (error) {
      this.handleError(error, 'findMessageDeletionJob');
    }
  }

  public async beginPreview(id: string): Promise<MessageDeletionJob | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set status = ${MessageDeletionJobStatus.DISCOVERING}::message_deletion_job_status,
            coverage = null,
            previewed_at = null,
            failed_at = null,
            last_error = null,
            updated_at = now()
        where id = ${id}::uuid
          and status in ('queued', 'failed')
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'beginMessageDeletionPreview');
    }
  }

  public async replacePreview(
    id: string,
    preview: MessageDeletionPreviewResult
  ): Promise<MessageDeletionJob> {
    try {
      if (preview.items.length > 500) {
        throw new Error('Message deletion previews cannot store more than 500 candidates.');
      }

      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          delete from message_deletion_items
          where job_id = ${id}::uuid
        `;

        for (const item of preview.items) {
          await tx.$executeRaw`
            insert into message_deletion_items (
              job_id,
              message_id,
              channel_id,
              author_id,
              message_created_at,
              message_edited_at,
              content_preview,
              attachment_count,
              discovery_source,
              bulk_delete_eligible,
              metadata
            ) values (
              ${id}::uuid,
              ${item.messageId},
              ${item.channelId},
              ${item.authorId},
              ${item.messageCreatedAt},
              ${item.messageEditedAt ?? null},
              ${item.contentPreview},
              ${item.attachmentCount},
              ${item.discoverySource}::message_deletion_discovery_source,
              ${item.bulkDeleteEligible},
              ${JSON.stringify(item.metadata ?? {})}::jsonb
            )
          `;
        }

        const rows = await tx.$queryRaw<MessageDeletionJob[]>`
          update message_deletion_jobs
          set status = ${MessageDeletionJobStatus.READY}::message_deletion_job_status,
              coverage = ${preview.coverage}::message_deletion_coverage,
              requested_window_start = ${preview.requestedWindowStart ?? null},
              requested_window_end = ${preview.requestedWindowEnd ?? null},
              previewed_at = now(),
              candidate_count = ${preview.items.length},
              preserved_count = 0,
              deleted_count = 0,
              already_missing_count = 0,
              changed_count = 0,
              evidence_failed_count = 0,
              delete_failed_count = 0,
              permission_denied_count = 0,
              completed_at = null,
              failed_at = null,
              last_error = null,
              metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
                preview.metadata ?? {}
              )}::jsonb,
              updated_at = now()
          where id = ${id}::uuid
            and status = ${MessageDeletionJobStatus.DISCOVERING}::message_deletion_job_status
          returning *
        `;
        if (!rows[0]) {
          throw new Error('Message deletion job is not awaiting a preview result.');
        }
        return rows[0];
      });
    } catch (error) {
      this.handleError(error, 'replaceMessageDeletionPreview');
    }
  }

  public async beginExecution(id: string): Promise<MessageDeletionJobWithItems | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set status = ${MessageDeletionJobStatus.EXECUTING}::message_deletion_job_status,
            started_at = now(),
            failed_at = null,
            last_error = null,
            updated_at = now()
        where id = ${id}::uuid
          and status = ${MessageDeletionJobStatus.READY}::message_deletion_job_status
          and (
            coverage = ${MessageDeletionCoverage.READY}::message_deletion_coverage
            or (
              scope = 'source_message'
              and coverage = ${MessageDeletionCoverage.PARTIAL}::message_deletion_coverage
              and candidate_count = 1
            )
          )
          and candidate_count > 0
          and candidate_count <= 100
        returning *
      `;
      if (!rows[0]) {
        return null;
      }
      const items = await this.prisma.$queryRaw<MessageDeletionItem[]>`
        select *
        from message_deletion_items
        where job_id = ${id}::uuid
        order by message_created_at asc, message_id asc
      `;
      return { ...rows[0], items };
    } catch (error) {
      this.handleError(error, 'beginMessageDeletionExecution');
    }
  }

  public async updateBanStatus(
    id: string,
    status: MessageDeletionBanStatus
  ): Promise<MessageDeletionJob | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set ban_status = ${status}::message_deletion_ban_status,
            updated_at = now()
        where id = ${id}::uuid
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'updateMessageDeletionBanStatus');
    }
  }

  public async markItemEvidencePreserved(
    itemId: string,
    evidenceMessageId: string,
    preservedAt = new Date()
  ): Promise<MessageDeletionItem | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionItem[]>`
        update message_deletion_items
        set evidence_status = ${MessageDeletionEvidenceStatus.PRESERVED}::message_deletion_evidence_status,
            evidence_message_id = ${evidenceMessageId},
            attempted_at = coalesce(attempted_at, ${preservedAt}),
            evidence_preserved_at = ${preservedAt}
        where id = ${itemId}::uuid
          and status = 'pending'::message_deletion_item_status
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'markMessageDeletionItemEvidencePreserved');
    }
  }

  public async updateCaseFinalizationStatus(
    id: string,
    status: MessageDeletionCaseFinalizationStatus
  ): Promise<MessageDeletionJob | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set case_finalization_status = ${status}::message_deletion_case_finalization_status,
            updated_at = now()
        where id = ${id}::uuid
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'updateMessageDeletionCaseFinalizationStatus');
    }
  }

  public async updateItemOutcome(
    itemId: string,
    outcome: MessageDeletionItemOutcome
  ): Promise<MessageDeletionItem | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionItem[]>`
        update message_deletion_items
        set status = ${outcome.status}::message_deletion_item_status,
            evidence_status = ${outcome.evidenceStatus}::message_deletion_evidence_status,
            evidence_message_id = ${outcome.evidenceMessageId ?? null},
            attempted_at = ${outcome.attemptedAt ?? new Date()},
            evidence_preserved_at = ${outcome.evidencePreservedAt ?? null},
            deleted_at = ${outcome.deletedAt ?? null},
            completed_at = ${outcome.completedAt ?? new Date()},
            failure_reason = ${outcome.failureReason ?? null},
            metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
              outcome.metadata ?? {}
            )}::jsonb
        where id = ${itemId}::uuid
          and status = 'pending'::message_deletion_item_status
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'updateMessageDeletionItemOutcome');
    }
  }

  public async complete(
    id: string,
    summary: MessageDeletionJobSummary
  ): Promise<MessageDeletionJob | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set status = ${MessageDeletionJobStatus.COMPLETED}::message_deletion_job_status,
            preserved_count = ${summary.preservedCount},
            deleted_count = ${summary.deletedCount},
            already_missing_count = ${summary.alreadyMissingCount},
            changed_count = ${summary.changedCount},
            evidence_failed_count = ${summary.evidenceFailedCount},
            delete_failed_count = ${summary.deleteFailedCount},
            permission_denied_count = ${summary.permissionDeniedCount},
            completed_at = now(),
            updated_at = now(),
            failed_at = null,
            last_error = null,
            metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(
              summary.metadata ?? {}
            )}::jsonb
        where id = ${id}::uuid
          and status = ${MessageDeletionJobStatus.EXECUTING}::message_deletion_job_status
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'completeMessageDeletionJob');
    }
  }

  public async fail(id: string, errorMessage: string): Promise<MessageDeletionJob | null> {
    try {
      const rows = await this.prisma.$queryRaw<MessageDeletionJob[]>`
        update message_deletion_jobs
        set status = ${MessageDeletionJobStatus.FAILED}::message_deletion_job_status,
            failed_at = now(),
            updated_at = now(),
            last_error = ${errorMessage}
        where id = ${id}::uuid
          and status not in ('completed', 'failed')
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'failMessageDeletionJob');
    }
  }

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    }
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }
    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }
}
