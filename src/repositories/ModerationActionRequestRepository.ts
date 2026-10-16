import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ModerationActionRequest,
  ModerationActionRequestCreate,
  ModerationActionRequestStatus,
} from './types';

export function getReportBanAttemptToken(request: ModerationActionRequest): string | undefined {
  const value = (request.metadata as Record<string, unknown> | null)?.report_ban_attempt_token;
  return typeof value === 'string' ? value : undefined;
}

export interface IModerationActionRequestRepository {
  enqueue(data: ModerationActionRequestCreate): Promise<ModerationActionRequest>;
  findById(id: string): Promise<ModerationActionRequest | null>;
  claimReportBanReconciliation(now: Date): Promise<ModerationActionRequest | null>;
  releaseReportBanPreparation(
    id: string,
    expectedPhase: 'preparing' | 'enforcement_started',
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null>;
  claimNext(): Promise<ModerationActionRequest | null>;
  heartbeat(id: string, expectedAttemptToken?: string): Promise<ModerationActionRequest | null>;
  mergeMetadata(
    id: string,
    metadata: Prisma.JsonObject,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null>;
  complete(
    id: string,
    result?: Prisma.JsonValue | null,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null>;
  fail(
    id: string,
    error: string,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null>;
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
          ${metadata}::jsonb || CASE WHEN ${data.actionType} = 'ban_observed_detection' THEN jsonb_build_object('report_ban_attempt_token', gen_random_uuid()::text) ELSE '{}'::jsonb END
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
            actor_id = case
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.actor_id
              else excluded.actor_id
            end,
            actor_surface = case
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.actor_surface
              else excluded.actor_surface
            end,
            message_deletion_job_id = coalesce(
              moderation_action_requests.message_deletion_job_id,
              excluded.message_deletion_job_id
            ),
            result = CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed' THEN '{}'::jsonb ELSE moderation_action_requests.result END,
            metadata = CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed'
              THEN (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(coalesce(moderation_action_requests.metadata, '{}'::jsonb)) WHERE key !~ '^report_ban_') || excluded.metadata
              ELSE coalesce(moderation_action_requests.metadata, '{}'::jsonb) || (excluded.metadata - 'report_ban_attempt_token') END
        WHERE NOT (moderation_action_requests.action_type = 'ban_observed_detection' AND (moderation_action_requests.metadata->>'report_ban_phase' IS NOT NULL OR coalesce(moderation_action_requests.result->'observed_ban_result'->>'status', '') IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')))
        returning *
      `;
      const request =
        rows.at(0) ??
        (await this.prisma.moderation_action_requests.findUnique({
          where: { idempotency_key: data.idempotencyKey },
        }));
      if (!request) throw new Error('Failed to enqueue moderation action request.');
      return request as ModerationActionRequest;
    } catch (error) {
      this.handleError(error, 'enqueueModerationActionRequest');
    }
  }

  public async findById(id: string): Promise<ModerationActionRequest | null> {
    try {
      return (await this.prisma.moderation_action_requests.findUnique({
        where: { id },
      })) as ModerationActionRequest | null;
    } catch (error) {
      this.handleError(error, 'findModerationActionRequestById');
    }
  }

  public async claimReportBanReconciliation(now: Date): Promise<ModerationActionRequest | null> {
    const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
      update moderation_action_requests
      set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('report_ban_lease_until', (${now}::timestamptz + interval '15 minutes')::text), updated_at = ${now}
      where id = (
        select id from moderation_action_requests
        where action_type = 'ban_observed_detection'
          and metadata->>'report_ban_phase' in ('preparing', 'enforcement_started', 'discord_confirmed', 'reconciliation_required')
          and coalesce((metadata->>'report_ban_retry_at')::timestamptz, '-infinity'::timestamptz) <= ${now}
          and coalesce((metadata->>'report_ban_lease_until')::timestamptz, updated_at + interval '15 minutes') <= ${now}
        order by updated_at asc for update skip locked limit 1
      ) returning *`;
    return rows[0] ?? null;
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
          and (
            verification_event_id is not null
            or action_type = 'complete_setup_verification'::moderation_action_request_type
          )
          and action_type not in (
            'preview_account_quarantine'::moderation_action_request_type,
            'quarantine_compromised_account'::moderation_action_request_type,
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
            metadata = CASE WHEN action_type = 'ban_observed_detection' THEN coalesce(metadata, '{}'::jsonb) || jsonb_build_object('report_ban_attempt_token', coalesce(metadata->>'report_ban_attempt_token', gen_random_uuid()::text)) ELSE metadata END,
            started_at = now(),
            updated_at = now()
        where id = (
          select id
          from moderation_action_requests
          where (status = 'queued'::moderation_action_request_status
               and coalesce(metadata->>'report_ban_phase', '') = '')
             or (
               status = 'processing'::moderation_action_request_status
               and action_type in (
                 'preview_account_quarantine'::moderation_action_request_type,
                 'quarantine_compromised_account'::moderation_action_request_type,
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

  public async heartbeat(
    id: string,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set updated_at = now(),
            metadata = case when metadata->>'report_ban_phase' is not null then metadata || jsonb_build_object('report_ban_lease_until', (now() + interval '15 minutes')::text) else metadata end
        where id = ${id}::uuid
          AND (action_type <> 'ban_observed_detection' OR metadata->>'report_ban_attempt_token' IS NOT DISTINCT FROM ${expectedAttemptToken ?? null}::text)
          and (status = 'processing'::moderation_action_request_status or metadata->>'report_ban_phase' is not null)
        returning *
      `;
      return rows.at(0) ?? (await this.findById(id));
    } catch (error) {
      this.handleError(error, 'heartbeatModerationActionRequest');
    }
  }

  public async mergeMetadata(
    id: string,
    metadata: Prisma.JsonObject,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    try {
      if (Object.keys(metadata).some((key) => key.startsWith('report_ban_'))) {
        return await this.mergeReportBanMetadata(id, metadata, expectedAttemptToken);
      }
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(metadata)}::jsonb,
            updated_at = now()
        where id = ${id}::uuid
        returning *
      `;
      return rows[0] ?? null;
    } catch (error) {
      this.handleError(error, 'mergeModerationActionRequestMetadata');
    }
  }

  private async mergeReportBanMetadata(
    id: string,
    patch: Prisma.JsonObject,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        ModerationActionRequest[]
      >`SELECT * FROM moderation_action_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows.at(0);
      if (!current) return null;
      if (getReportBanAttemptToken(current) !== expectedAttemptToken) return current;
      const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
      if (!this.canAdvanceReportBanPhase(current, patch)) return current;
      if (
        patch.report_ban_phase === 'enforcement_started' &&
        !(await this.ownsPreparedCases(transaction, current, patch))
      )
        return current;
      const ownedPatch = this.ownedReportBanPatch(metadata, patch);
      const updated = await transaction.$queryRaw<ModerationActionRequest[]>`
        UPDATE moderation_action_requests SET metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(ownedPatch)}::jsonb, updated_at = now()
        WHERE id = ${id}::uuid RETURNING *`;
      return updated[0] ?? null;
    });
  }

  private canAdvanceReportBanPhase(
    current: ModerationActionRequest,
    patch: Prisma.JsonObject
  ): boolean {
    const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
    const receipt = ((current.result ?? {}) as Prisma.JsonObject).observed_ban_result as
      | Prisma.JsonObject
      | undefined;
    const phase = metadata.report_ban_phase;
    const next = patch.report_ban_phase;
    if (receipt?.status === 'banned' && next !== null) return false;
    if (current.status === ModerationActionRequestStatus.FAILED && !phase) return false;
    if (phase === 'discord_confirmed' && next && next !== 'discord_confirmed') return false;
    if (phase && next === 'preparing') return false;
    return next !== 'enforcement_started' || phase === 'preparing';
  }

  private ownedReportBanPatch(
    metadata: Prisma.JsonObject,
    patch: Prisma.JsonObject
  ): Prisma.JsonObject {
    const owned = { ...patch };
    delete owned.report_ban_attempt_token;
    if (metadata.report_ban_confirmed_at) delete owned.report_ban_confirmed_at;
    if (metadata.report_ban_phase && metadata.report_ban_phase !== 'preparing') {
      for (const key of [
        'report_ban_cases',
        'report_ban_case_ids',
        'report_ban_attempt_id',
        'report_ban_preparation_id',
        'report_ban_enforcement_id',
      ])
        delete owned[key];
    }
    return owned;
  }

  private async ownsPreparedCases(
    transaction: Prisma.TransactionClient,
    current: ModerationActionRequest,
    patch: Prisma.JsonObject
  ): Promise<boolean> {
    // Request lock is held; acquire report, detection, then sorted case locks.
    if (!(await this.lockReportBanContext(transaction, current))) return false;
    const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
    const candidates = Array.isArray(metadata.report_ban_cases)
      ? (metadata.report_ban_cases as Prisma.JsonObject[])
      : [];
    const acquired = Array.isArray(patch.report_ban_case_ids) ? patch.report_ban_case_ids : [];
    if (
      candidates.length !== acquired.length ||
      candidates.some((event) => !acquired.includes(String(event.id)))
    )
      return false;
    const cases = await transaction.verification_events.findMany({
      where: { id: { in: acquired as string[] } },
    });
    return (
      cases.length === acquired.length &&
      cases.every(
        (event) =>
          event.status === 'pending' &&
          event.containment_status === 'in_progress' &&
          event.quarantine_attempt_id === metadata.report_ban_attempt_id
      )
    );
  }

  private async lockReportBanContext(
    transaction: Prisma.TransactionClient,
    request: ModerationActionRequest
  ): Promise<boolean> {
    const metadata = (request.metadata ?? {}) as Prisma.JsonObject;
    const report = request.report_intake_id
      ? await transaction.$queryRaw<
          Array<{
            status: string;
            server_id: string;
            confirmed_target_user_id: string | null;
            operation_id: string | null;
          }>
        >`
      SELECT status, server_id, confirmed_target_user_id, metadata->>'report_ban_operation_id' AS operation_id
      FROM report_intakes WHERE id = ${request.report_intake_id}::uuid FOR UPDATE`
      : [];
    const detection = await transaction.$queryRaw<
      Array<{ operation_id: string | null; action: string | null }>
    >`
      SELECT metadata->>'report_ban_operation_id' AS operation_id, metadata->>'observed_action' AS action
      FROM detection_events WHERE id = ${request.detection_event_id}::uuid FOR UPDATE`;
    const cases = Array.isArray(metadata.report_ban_cases)
      ? (metadata.report_ban_cases as Prisma.JsonObject[])
      : [];
    const ids = cases.map((event) => String(event.id)).sort();
    if (ids.length)
      await transaction.$queryRaw`SELECT id FROM verification_events WHERE id::text = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    return (
      (!request.report_intake_id ||
        (report[0]?.status === 'submitted' &&
          report[0].server_id === request.server_id &&
          report[0].confirmed_target_user_id === request.target_user_id &&
          report[0].operation_id === request.id)) &&
      detection[0]?.operation_id === request.id &&
      detection[0].action === 'ban'
    );
  }

  public async releaseReportBanPreparation(
    id: string,
    expectedPhase: 'preparing' | 'enforcement_started',
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<
        ModerationActionRequest[]
      >`SELECT * FROM moderation_action_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows.at(0);
      if (!current) return null;
      if (getReportBanAttemptToken(current) !== expectedAttemptToken) return current;
      const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
      // A failed preparation may still have a late-acquired guard from its paused owner.
      const failedPreparation =
        !metadata.report_ban_phase && current.status === ModerationActionRequestStatus.FAILED;
      if (metadata.report_ban_phase !== expectedPhase && !failedPreparation) return current;
      await this.lockReportBanContext(transaction, current);
      const cases = Array.isArray(metadata.report_ban_cases) ? metadata.report_ban_cases : [];
      await transaction.$executeRaw`
        UPDATE verification_events v SET
          case_kind = (original->>'case_kind')::case_kind,
          attention_state = (original->>'attention_state')::case_attention_state,
          containment_status = (original->>'containment_status')::case_containment_status,
          quarantine_attempt_id = null, quarantine_lease_renewed_at = null,
          parked_at = (original->>'parked_at')::timestamptz, parked_by = original->>'parked_by', updated_at = now()
        FROM jsonb_array_elements(${JSON.stringify(cases)}::jsonb) original
        WHERE v.id::text = original->>'id' AND v.status = 'pending' AND v.containment_status = 'in_progress'
          AND v.quarantine_attempt_id = ${String(metadata.report_ban_attempt_id ?? '')}
      `;
      await transaction.$executeRaw`
        UPDATE detection_events SET metadata = metadata - 'observed_action' - 'observed_action_by' - 'observed_action_at' - 'report_ban_operation_id'
        WHERE id = ${current.detection_event_id}::uuid AND metadata->>'report_ban_operation_id' = ${id} AND metadata->>'observed_action' = 'ban'`;
      if (current.report_intake_id)
        await transaction.$executeRaw`
        UPDATE report_intakes SET metadata = metadata - 'report_ban_operation_id', updated_at = now()
        WHERE id = ${current.report_intake_id}::uuid AND status = 'submitted' AND metadata->>'report_ban_operation_id' = ${id}`;
      const updated = await transaction.$queryRaw<ModerationActionRequest[]>`
        UPDATE moderation_action_requests SET status = 'failed', failed_at = now(), updated_at = now(),
          last_error = 'Ban was not applied. Preparation released.',
          metadata = metadata || '{"report_ban_phase": null, "report_ban_lease_until": null}'::jsonb
        WHERE id = ${id}::uuid RETURNING *`;
      return updated[0] ?? null;
    });
  }

  public async complete(
    id: string,
    result: Prisma.JsonValue | null = {},
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set status = ${ModerationActionRequestStatus.COMPLETED}::moderation_action_request_status,
            completed_at = now(),
            updated_at = now(),
            last_error = null,
            result = CASE WHEN action_type = 'ban_observed_detection' AND metadata->>'report_ban_phase' = 'discord_confirmed' AND ${JSON.stringify(result ?? {})}::jsonb->'observed_ban_result'->>'status' = 'ban_outcome_unknown' THEN jsonb_set(${JSON.stringify(result ?? {})}::jsonb, '{observed_ban_result,status}', '"banned_updates_pending"'::jsonb) ELSE ${JSON.stringify(result ?? {})}::jsonb END
        where id = ${id}::uuid
          AND (action_type <> 'ban_observed_detection' OR metadata->>'report_ban_attempt_token' IS NOT DISTINCT FROM ${expectedAttemptToken ?? null}::text)
          AND NOT (action_type = 'ban_observed_detection' AND coalesce(result->'observed_ban_result'->>'status', '') = 'banned')
          AND NOT (action_type = 'ban_observed_detection' AND coalesce(result->'observed_ban_result'->>'status', '') = 'banned_updates_pending' AND ${JSON.stringify(result ?? {})}::jsonb->'observed_ban_result'->>'status' = 'ban_outcome_unknown')
        returning *
      `;
      return rows[0] ?? (await this.findById(id));
    } catch (error) {
      this.handleError(error, 'completeModerationActionRequest');
    }
  }

  public async fail(
    id: string,
    errorMessage: string,
    expectedAttemptToken?: string
  ): Promise<ModerationActionRequest | null> {
    try {
      const rows = await this.prisma.$queryRaw<ModerationActionRequest[]>`
        update moderation_action_requests
        set status = ${ModerationActionRequestStatus.FAILED}::moderation_action_request_status,
            failed_at = now(),
            updated_at = now(),
            last_error = ${errorMessage}
        where id = ${id}::uuid
          AND (action_type <> 'ban_observed_detection' OR metadata->>'report_ban_attempt_token' IS NOT DISTINCT FROM ${expectedAttemptToken ?? null}::text)
          AND NOT (action_type = 'ban_observed_detection' AND (metadata->>'report_ban_phase' IS NOT NULL OR coalesce(result->'observed_ban_result'->>'status', '') IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')))
        returning *
      `;
      return rows[0] ?? (await this.findById(id));
    } catch (error) {
      this.handleError(error, 'failModerationActionRequest');
    }
  }
}
