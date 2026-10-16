import { REPORT_BAN_TERMINAL_ATTEMPT_PREFIX } from '../utils/caseRoleRelease';
import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ModerationActionRequest,
  ModerationActionRequestCreate,
  ModerationActionRequestStatus,
} from './types';

// Only a fresh explicit request may reset a completed no-op; the worker revalidates ownership.
const completedNoopRetry = Prisma.sql`(moderation_action_requests.status = 'completed'
  AND moderation_action_requests.action_type = 'ban_observed_detection'
  AND excluded.action_type = moderation_action_requests.action_type
  AND moderation_action_requests.result->'observed_ban_result' = '{"status":"already_handled"}'::jsonb
  AND moderation_action_requests.metadata->>'report_ban_phase' IS NULL
  AND moderation_action_requests.metadata->>'report_ban_enforcement_id' IS NULL
  AND moderation_action_requests.metadata->>'report_ban_enforcement_operation_id' IS NULL
  AND moderation_action_requests.metadata->>'report_ban_confirmed_at' IS NULL
  AND moderation_action_requests.server_id = excluded.server_id
  AND moderation_action_requests.target_user_id IS NOT DISTINCT FROM excluded.target_user_id
  AND moderation_action_requests.detection_event_id IS NOT DISTINCT FROM excluded.detection_event_id
  AND moderation_action_requests.report_intake_id IS NOT DISTINCT FROM excluded.report_intake_id
  AND moderation_action_requests.verification_event_id IS NOT DISTINCT FROM excluded.verification_event_id
  AND moderation_action_requests.message_deletion_job_id IS NOT DISTINCT FROM excluded.message_deletion_job_id
  AND EXISTS (
    SELECT 1 FROM detection_events d
    WHERE d.id = moderation_action_requests.detection_event_id
      AND d.server_id = moderation_action_requests.server_id AND d.user_id = moderation_action_requests.target_user_id
      AND NOT (coalesce(d.metadata, '{}'::jsonb) ? 'observed_action')
      AND coalesce(d.metadata->>'report_ban_operation_id', '') = ''
      AND d.metadata->>'reportIntakeId' IS NOT DISTINCT FROM moderation_action_requests.report_intake_id::text
      AND (moderation_action_requests.report_intake_id IS NULL OR EXISTS (
        SELECT 1 FROM report_intakes r WHERE r.id = moderation_action_requests.report_intake_id
          AND r.server_id = d.server_id AND r.confirmed_target_user_id = d.user_id AND r.status = 'submitted'
          AND coalesce(r.metadata->>'report_ban_operation_id', '') = ''
      ))
  ))`;

export function getReportBanAttemptToken(request: ModerationActionRequest): string | undefined {
  const value = (request.metadata as Record<string, unknown> | null)?.report_ban_attempt_token;
  return typeof value === 'string' ? value : undefined;
}

export interface ReportBanReviewDisposition {
  operationId: string;
  attemptToken: string;
  updatedAt: Date;
  serverId: string;
  actorId: string;
  reason: string;
  banAbsentCheckedAt: Date;
}

export interface IModerationActionRequestRepository {
  adoptConfirmedReportBanCases(
    id: string,
    attemptToken: string
  ): Promise<ModerationActionRequest | null>;
  reviewUncertainReportBan(
    input: ReportBanReviewDisposition
  ): Promise<ModerationActionRequest | null>;
  claimReportBanCompletionAnalytics(id: string, attemptToken: string): Promise<boolean>;
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
              when ${completedNoopRetry} then 'queued'::moderation_action_request_status
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.status
              else 'queued'::moderation_action_request_status
            end,
            updated_at = now(),
          requested_at = CASE WHEN ${completedNoopRetry} THEN now() ELSE moderation_action_requests.requested_at END,
          started_at = CASE WHEN ${completedNoopRetry} THEN null ELSE moderation_action_requests.started_at END,
          completed_at = CASE WHEN ${completedNoopRetry} THEN null ELSE moderation_action_requests.completed_at END,
          attempts = CASE WHEN ${completedNoopRetry} THEN 0 ELSE moderation_action_requests.attempts END,
            failed_at = null,
            last_error = null,
            actor_id = case
              when ${completedNoopRetry} then excluded.actor_id
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.actor_id
              else excluded.actor_id
            end,
            actor_surface = case
              when ${completedNoopRetry} then excluded.actor_surface
              when moderation_action_requests.status in ('processing', 'completed')
                then moderation_action_requests.actor_surface
              else excluded.actor_surface
            end,
            message_deletion_job_id = coalesce(
              moderation_action_requests.message_deletion_job_id,
              excluded.message_deletion_job_id
            ),
            result = CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetry} THEN '{}'::jsonb ELSE moderation_action_requests.result END,
            metadata = CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetry}
              THEN (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(coalesce(moderation_action_requests.metadata, '{}'::jsonb)) WHERE key !~ '^report_ban_') || (excluded.metadata - 'observed_ban_reviews')
              ELSE coalesce(moderation_action_requests.metadata, '{}'::jsonb) || (CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection' THEN excluded.metadata - 'observed_ban_reviews' ELSE excluded.metadata END - 'report_ban_attempt_token') END
        WHERE (moderation_action_requests.action_type <> 'ban_observed_detection' OR moderation_action_requests.status NOT IN ('completed', 'processing') OR ${completedNoopRetry}) AND NOT (moderation_action_requests.action_type = 'ban_observed_detection' AND (moderation_action_requests.metadata->>'report_ban_phase' IS NOT NULL OR coalesce(moderation_action_requests.result->'observed_ban_result'->>'status', '') IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')))
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
            or action_type = 'ban_observed_detection'::moderation_action_request_type
          )
          and (action_type <> 'ban_observed_detection' OR (
            metadata->>'report_ban_phase' IS NULL
            AND coalesce(result->'observed_ban_result'->>'status', '') NOT IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')
          ))
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
      if (patch.report_ban_phase === 'enforcement_started') {
        // The request and case locks are held. Observers can resolve preparation, but
        // once enforcement starts only this durable operation owns case completion.
        await transaction.$executeRaw`
          UPDATE verification_events SET metadata = coalesce(nullif(metadata, 'null'::jsonb), '{}'::jsonb) ||
            jsonb_build_object('report_ban_enforcement_operation_id', ${id}::text)
          WHERE id::text = ANY(${(patch.report_ban_case_ids ?? []) as string[]}::text[])
            AND quarantine_attempt_id = ${String(metadata.report_ban_attempt_id)}`;
      }
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
        'report_ban_membership_joined_at',
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
    request: ModerationActionRequest,
    caseIds?: string[],
    confirmed = false
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
    const ids = [
      ...new Set([...cases.map((event) => String(event.id)), ...(caseIds ?? [])]),
    ].sort();
    if (ids.length)
      await transaction.$queryRaw`SELECT id FROM verification_events WHERE id::text = ANY(${ids}::text[]) ORDER BY id FOR UPDATE`;
    return (
      (!request.report_intake_id ||
        ((report[0]?.status === 'submitted' || (confirmed && report[0]?.status === 'actioned')) &&
          report[0].server_id === request.server_id &&
          report[0].confirmed_target_user_id === request.target_user_id &&
          report[0].operation_id === request.id)) &&
      detection[0]?.operation_id === request.id &&
      detection[0].action === 'ban'
    );
  }

  public async adoptConfirmedReportBanCases(
    id: string,
    attemptToken: string
  ): Promise<ModerationActionRequest | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ModerationActionRequest[]>`
        SELECT * FROM moderation_action_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const current = rows.at(0);
      if (
        !current ||
        !current.target_user_id ||
        current.action_type !== 'ban_observed_detection' ||
        getReportBanAttemptToken(current) !== attemptToken
      )
        return null;
      const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
      if (metadata.report_ban_phase !== 'discord_confirmed' || !metadata.report_ban_confirmed_at)
        return null;
      const confirmedAt = new Date(String(metadata.report_ban_confirmed_at));
      const savedIds = Array.isArray(metadata.report_ban_case_ids)
        ? (metadata.report_ban_case_ids as string[])
        : [];
      const candidates = await transaction.verification_events.findMany({
        where: {
          server_id: current.server_id,
          user_id: current.target_user_id,
          status: 'pending',
          created_at: { lte: confirmedAt },
          id: { notIn: savedIds },
        },
      });
      if (
        !(await this.lockReportBanContext(
          transaction,
          current,
          candidates.map((event) => event.id),
          true
        ))
      )
        return null;
      const locked = await transaction.verification_events.findMany({
        where: {
          id: { in: candidates.map((event) => event.id) },
          server_id: current.server_id,
          user_id: current.target_user_id,
          status: 'pending',
          created_at: { lte: confirmedAt },
        },
      });
      const adopted = [];
      for (const event of locked) {
        const snapshot = ((event.metadata ?? {}) as Prisma.JsonObject).user_snapshot as
          | Prisma.JsonObject
          | undefined;
        const joinedAt = snapshot?.joined_at;
        const expectedJoin = metadata.report_ban_membership_joined_at;
        if (
          typeof expectedJoin !== 'string' ||
          typeof joinedAt !== 'string' ||
          !Number.isFinite(Date.parse(expectedJoin)) ||
          !Number.isFinite(Date.parse(joinedAt))
        )
          throw new Error('Late case membership is unknown; cleanup requires review.');
        if (
          Date.parse(joinedAt) !== Date.parse(expectedJoin) ||
          (event.parked_at && event.parked_at > confirmedAt)
        )
          continue;
        if (
          event.quarantine_attempt_id ||
          event.containment_status === 'in_progress' ||
          ((event.metadata ?? {}) as Prisma.JsonObject).report_ban_enforcement_operation_id
        )
          throw new Error('Late case has competing ownership; confirmed cleanup is pending.');
        adopted.push(event);
      }
      if (!adopted.length) return current;
      const attemptId = String(metadata.report_ban_attempt_id);
      if (!attemptId.startsWith(REPORT_BAN_TERMINAL_ATTEMPT_PREFIX))
        throw new Error('Confirmed ban case attempt is missing.');
      await transaction.verification_events.updateMany({
        where: { id: { in: adopted.map((event) => event.id) } },
        data: {
          containment_status: 'in_progress',
          quarantine_attempt_id: attemptId,
          quarantine_lease_renewed_at: new Date(),
          updated_at: new Date(),
        },
      });
      await transaction.$executeRaw`
        UPDATE verification_events SET metadata = coalesce(nullif(metadata, 'null'::jsonb), '{}'::jsonb) ||
          jsonb_build_object('report_ban_enforcement_operation_id', ${id}::text)
        WHERE id::text = ANY(${adopted.map((event) => event.id)}::text[])`;
      const prior = Array.isArray(metadata.report_ban_cases) ? metadata.report_ban_cases : [];
      return transaction.moderation_action_requests.update({
        where: { id },
        data: {
          metadata: {
            ...metadata,
            report_ban_case_ids: [...savedIds, ...adopted.map((event) => event.id)],
            report_ban_cases: [
              ...prior,
              ...adopted.map((event) => ({
                id: event.id,
                case_kind: event.case_kind,
                attention_state: event.attention_state,
                containment_status: event.containment_status,
                parked_at: event.parked_at?.toISOString() ?? null,
                parked_by: event.parked_by,
              })),
            ],
          },
          updated_at: new Date(),
        },
      }) as Promise<ModerationActionRequest>;
    });
  }

  private async releaseReportBanClaims(
    transaction: Prisma.TransactionClient,
    current: ModerationActionRequest
  ): Promise<void> {
    const id = current.id;
    const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
    const cases = Array.isArray(metadata.report_ban_cases) ? metadata.report_ban_cases : [];
    await transaction.$executeRaw`
        UPDATE verification_events v SET
          case_kind = (original->>'case_kind')::case_kind,
          attention_state = (original->>'attention_state')::case_attention_state,
          containment_status = (original->>'containment_status')::case_containment_status,
          quarantine_attempt_id = null, quarantine_lease_renewed_at = null,
          metadata = coalesce(nullif(v.metadata, 'null'::jsonb), '{}'::jsonb) - 'report_ban_enforcement_operation_id',
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
  }

  public async reviewUncertainReportBan(
    input: ReportBanReviewDisposition
  ): Promise<ModerationActionRequest | null> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ModerationActionRequest[]>`
        SELECT * FROM moderation_action_requests WHERE id = ${input.operationId}::uuid FOR UPDATE`;
      const current = rows.at(0);
      if (
        !current ||
        current.server_id !== input.serverId ||
        current.action_type !== 'ban_observed_detection'
      )
        return null;
      const metadata = (current.metadata ?? {}) as Prisma.JsonObject;
      const result = (current.result ?? {}) as Prisma.JsonObject;
      const receipt = result.observed_ban_result as Prisma.JsonObject | undefined;
      const history = Array.isArray(metadata.observed_ban_reviews)
        ? metadata.observed_ban_reviews
        : [];
      const prior = history.at(-1) as Prisma.JsonObject | undefined;
      if (
        receipt?.status === 'ban_reviewed_no_current_ban' &&
        prior?.attempt_token === input.attemptToken
      )
        return current;
      if (
        getReportBanAttemptToken(current) !== input.attemptToken ||
        current.updated_at?.getTime() !== input.updatedAt.getTime() ||
        metadata.report_ban_phase !== 'reconciliation_required' ||
        metadata.report_ban_confirmed_at ||
        receipt?.status !== 'ban_outcome_unknown' ||
        !input.reason.trim()
      )
        return null;
      if (!(await this.lockReportBanContext(transaction, current))) return null;
      const review = {
        operation_id: current.id,
        attempt_token: input.attemptToken,
        reviewed_by: input.actorId,
        reason: input.reason.trim(),
        reviewed_at: new Date().toISOString(),
        ban_absent_checked_at: input.banAbsentCheckedAt.toISOString(),
        disposition: 'no_current_ban_historical_outcome_uncertain',
        result,
        operation_metadata: Object.fromEntries(
          Object.entries(metadata).filter(([key]) => key.startsWith('report_ban_'))
        ),
      };
      await this.releaseReportBanClaims(transaction, current);
      const updated = await transaction.$queryRaw<ModerationActionRequest[]>`
        UPDATE moderation_action_requests SET status = 'failed', failed_at = now(), updated_at = now(),
          last_error = null,
          result = jsonb_build_object('observed_ban_result', jsonb_build_object('status', 'ban_reviewed_no_current_ban', 'operationId', ${current.id}::text)),
          metadata = metadata || jsonb_build_object('observed_ban_reviews', ${JSON.stringify([...history, review])}::jsonb,
            'report_ban_phase', null, 'report_ban_lease_until', null, 'report_ban_retry_at', null, 'report_ban_last_error', null,
            'report_ban_attempt_token', gen_random_uuid()::text)
        WHERE id = ${current.id}::uuid RETURNING *`;
      return updated.at(0) ?? null;
    });
  }

  public async claimReportBanCompletionAnalytics(
    id: string,
    attemptToken: string
  ): Promise<boolean> {
    const count = await this.prisma.$executeRaw`
      UPDATE moderation_action_requests SET metadata = metadata || jsonb_build_object('report_ban_analytics_claimed_at', now()::text)
      WHERE id = ${id}::uuid AND metadata->>'report_ban_attempt_token' = ${attemptToken}
        AND result->'observed_ban_result'->>'status' = 'banned'
        AND metadata->>'report_ban_analytics_claimed_at' IS NULL`;
    return count === 1;
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
      await this.releaseReportBanClaims(transaction, current);
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
