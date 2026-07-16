import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ModerationActionRequest,
  ModerationActionRequestCreate,
  ModerationActionRequestStatus,
} from './types';

export interface IModerationActionRequestRepository {
  enqueue(data: ModerationActionRequestCreate): Promise<ModerationActionRequest>;
  claimNext(): Promise<ModerationActionRequest | null>;
  heartbeat(id: string): Promise<ModerationActionRequest | null>;
  complete(id: string, result?: Prisma.JsonValue | null): Promise<ModerationActionRequest | null>;
  fail(id: string, error: string): Promise<ModerationActionRequest | null>;
}

@injectable()
export class ModerationActionRequestRepository implements IModerationActionRequestRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

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

  public async enqueue(data: ModerationActionRequestCreate): Promise<ModerationActionRequest> {
    try {
      const metadata = JSON.stringify(data.metadata ?? {});
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        insert into moderation_action_requests (
          server_id,
          action_type,
          status,
          actor_id,
          actor_surface,
          target_user_id,
          detection_event_id,
          report_intake_id,
          verification_event_id,
          message_deletion_job_id,
          idempotency_key,
          metadata
        )
        values (
          ${data.serverId},
          ${data.actionType}::moderation_action_request_type,
          'queued'::moderation_action_request_status,
          ${data.actorId},
          ${data.actorSurface},
          ${data.targetUserId ?? null},
          ${data.detectionEventId ?? null}::uuid,
          ${data.reportIntakeId ?? null}::uuid,
          ${data.verificationEventId ?? null}::uuid,
          ${data.messageDeletionJobId ?? null}::uuid,
          ${data.idempotencyKey},
          ${metadata}::jsonb
        )
        on conflict (idempotency_key) do update
        set status = case
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.status
              else 'queued'::moderation_action_request_status
            end,
            updated_at = now(),
            failed_at = null,
            last_error = null,
            message_deletion_job_id = coalesce(
              moderation_action_requests.message_deletion_job_id,
              excluded.message_deletion_job_id
            ),
            metadata = coalesce(moderation_action_requests.metadata, '{}'::jsonb) || excluded.metadata
        returning *
      `;
      if (!rows[0]) {
        throw new Error('Failed to enqueue moderation action request.');
      }
      return rows[0];
    } catch (error) {
      this.handleError(error, 'enqueueModerationActionRequest');
    }
  }

  public async claimNext(): Promise<ModerationActionRequest | null> {
    try {
      await this.prisma.$executeRaw`
        update moderation_action_requests
        set status = 'failed'::moderation_action_request_status,
            failed_at = now(),
            updated_at = now(),
            last_error = 'Worker interrupted before this action completed.'
        where status = 'processing'::moderation_action_request_status
          and verification_event_id is not null
          and action_type not in (
            'preview_case_message_deletion'::moderation_action_request_type,
            'execute_case_message_deletion'::moderation_action_request_type,
            'ban_case_user_with_message_cleanup'::moderation_action_request_type
          )
          and updated_at < now() - interval '15 minutes'
      `;
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set status = 'processing'::moderation_action_request_status,
            attempts = attempts + 1,
            started_at = now(),
            updated_at = now()
        where id = (
          select id
          from moderation_action_requests
          where status = 'queued'::moderation_action_request_status
             or (
               status = 'processing'::moderation_action_request_status
               and action_type in (
                 'preview_case_message_deletion'::moderation_action_request_type,
                 'execute_case_message_deletion'::moderation_action_request_type,
                 'ban_case_user_with_message_cleanup'::moderation_action_request_type
               )
               and updated_at < now() - interval '15 minutes'
             )
          order by
            case when status = 'queued'::moderation_action_request_status then 0 else 1 end,
            requested_at asc nulls last
          for update skip locked
          limit 1
        )
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'claimModerationActionRequest');
    }
  }

  public async heartbeat(id: string): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set updated_at = now()
        where id = ${id}::uuid
          and status = 'processing'::moderation_action_request_status
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'heartbeatModerationActionRequest');
    }
  }

  public async complete(
    id: string,
    result: Prisma.JsonValue | null = {}
  ): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set status = ${ModerationActionRequestStatus.COMPLETED}::moderation_action_request_status,
            completed_at = now(),
            updated_at = now(),
            last_error = null,
            result = ${JSON.stringify(result ?? {})}::jsonb
        where id = ${id}::uuid
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'completeModerationActionRequest');
    }
  }

  public async fail(id: string, errorMessage: string): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set status = ${ModerationActionRequestStatus.FAILED}::moderation_action_request_status,
            failed_at = now(),
            updated_at = now(),
            last_error = ${errorMessage}
        where id = ${id}::uuid
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'failModerationActionRequest');
    }
  }
}
