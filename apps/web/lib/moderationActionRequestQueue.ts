import type { Pool, PoolClient } from 'pg';
import { getPostgresPool } from './setupDataAdapter';

// Only a fresh explicit request may reset a completed no-op; the worker revalidates ownership.
const completedNoopRetry = `(moderation_action_requests.status = 'completed'
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

export type ModerationActionRequestActionType =
  | 'open_case_from_observed_detection'
  | 'open_admin_case'
  | 'manual_flag_user'
  | 'submit_user_report'
  | 'start_report_intake'
  | 'close_report_intake'
  | 'dismiss_observed_detection'
  | 'mark_observed_detection_false_positive'
  | 'undo_observed_detection_action'
  | 'kick_observed_detection'
  | 'ban_observed_detection'
  | 'ignore_detection_accounting'
  | 'restore_detection_accounting'
  | 'verify_case_user'
  | 'preview_account_quarantine'
  | 'quarantine_compromised_account'
  | 'close_case_no_action'
  | 'kick_case_user'
  | 'ban_case_user'
  | 'preview_case_message_deletion'
  | 'execute_case_message_deletion'
  | 'ban_case_user_with_message_cleanup'
  | 'ban_case_user_by_id'
  | 'repair_active_case'
  | 'reopen_case'
  | 'refresh_case_notification'
  | 'sync_moderation_queue'
  | 'clear_moderation_queue'
  | 'close_resolved_case_threads'
  | 'audit_case_role_lockdown'
  | 'apply_case_role_lockdown'
  | 'intake_role_members'
  | 'sync_existing_ban'
  | 'complete_setup_verification'
  | 'upsert_report_instructions'
  | 'request_captcha_challenge'
  | 'retry_captcha_challenge'
  | 'bypass_captcha_challenge'
  | 'apply_captcha_pass'
  | 'notify_captcha_attention';

export type ModerationActionRequestQueueStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ModerationActionRequestReceipt {
  readonly id: string;
  readonly messageDeletionJobId?: string | null;
  readonly status: ModerationActionRequestQueueStatus;
}

interface ActiveModerationActionRequestReceipt extends ModerationActionRequestReceipt {
  readonly idempotencyKey: string;
}

export interface QueueModerationActionRequestInput {
  readonly actionType: ModerationActionRequestActionType;
  readonly actorId: string;
  readonly actorSurface: string;
  readonly detectionEventId?: string | null;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, unknown>;
  readonly messageDeletionJobId?: string | null;
  readonly reportIntakeId?: string | null;
  readonly serverId: string;
  readonly targetUserId?: string | null;
  readonly verificationEventId?: string | null;
}

export async function queueModerationActionRequest(
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestQueueStatus> {
  return (await queueModerationActionRequestWithReceipt(input)).status;
}

export async function queueModerationActionRequestWithReceipt(
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestReceipt> {
  return insertModerationActionRequestWithReceipt(getPostgresPool(), input);
}

export async function insertModerationActionRequestWithReceipt(
  client: Pool | PoolClient,
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestReceipt> {
  const result = await client.query<ModerationActionRequestReceipt>(
    `with upserted as (
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
       $1,
       $2::moderation_action_request_type,
       'queued',
       $3,
       $4,
       $5,
       $6::uuid,
       $7::uuid,
       $8::uuid,
       $9::uuid,
       $10,
       $11::jsonb || CASE WHEN $2 = 'ban_observed_detection' THEN jsonb_build_object('report_ban_attempt_token', gen_random_uuid()::text) ELSE '{}'::jsonb END
     )
       on conflict (idempotency_key) do update
       set status = case
              when ${completedNoopRetry} then 'queued'::moderation_action_request_status
             when moderation_action_requests.status in ('processing', 'completed')
               then moderation_action_requests.status
             else 'queued'
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
          result = CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetry} THEN '{}'::jsonb ELSE moderation_action_requests.result END,
          metadata = CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetry}
            THEN (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(coalesce(moderation_action_requests.metadata, '{}'::jsonb)) WHERE key !~ '^report_ban_') || (excluded.metadata - 'observed_ban_reviews')
            ELSE coalesce(moderation_action_requests.metadata, '{}'::jsonb) || (CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection' THEN excluded.metadata - 'observed_ban_reviews' ELSE excluded.metadata END - 'report_ban_attempt_token') END,
         message_deletion_job_id = coalesce(
           moderation_action_requests.message_deletion_job_id,
           excluded.message_deletion_job_id
          )
       where (moderation_action_requests.status = 'failed' OR ${completedNoopRetry}
          or (
            moderation_action_requests.status = 'queued'
            and moderation_action_requests.action_type <>
              'apply_captcha_pass'::moderation_action_request_type
          )
       ) AND NOT (moderation_action_requests.action_type = 'ban_observed_detection' AND (moderation_action_requests.metadata->>'report_ban_phase' IS NOT NULL OR coalesce(moderation_action_requests.result->'observed_ban_result'->>'status', '') IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')))
       returning
         id::text,
         message_deletion_job_id::text as "messageDeletionJobId",
         status::text as status
     )
     select id, "messageDeletionJobId", status from upserted
     union all
     select
       request.id::text,
       request.message_deletion_job_id::text as "messageDeletionJobId",
       request.status::text as status
     from moderation_action_requests as request
     where request.idempotency_key = $10
       and not exists (select 1 from upserted)
     limit 1`,
    [
      input.serverId,
      input.actionType,
      input.actorId,
      input.actorSurface,
      input.targetUserId ?? null,
      input.detectionEventId ?? null,
      input.reportIntakeId ?? null,
      input.verificationEventId ?? null,
      input.messageDeletionJobId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.metadata ?? {}),
    ]
  );

  return (
    result.rows[0] ?? {
      id: input.idempotencyKey,
      messageDeletionJobId: input.messageDeletionJobId ?? null,
      status: 'failed',
    }
  );
}

export async function queueSerializedModerationActionRequestWithReceipt(
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestReceipt> {
  const client = await getPostgresPool().connect();

  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
      `drasil:${input.actionType}:${input.serverId}`,
    ]);

    const active = await client.query<ActiveModerationActionRequestReceipt>(
      `select
         id::text,
         message_deletion_job_id::text as "messageDeletionJobId",
         status::text as status,
         idempotency_key as "idempotencyKey"
       from moderation_action_requests
       where server_id = $1
         and action_type = $2::moderation_action_request_type
         and status in ('queued', 'processing')
       order by requested_at asc
       limit 1`,
      [input.serverId, input.actionType]
    );

    const activeReceipt = active.rows[0];
    if (activeReceipt && activeReceipt.idempotencyKey !== input.idempotencyKey) {
      throw new Error(
        'Another Drasil setup is already in progress for this server. Wait for it to finish, then review and submit your choices again.'
      );
    }
    const receipt =
      activeReceipt ?? (await insertModerationActionRequestWithReceipt(client, input));
    await client.query('commit');
    return {
      id: receipt.id,
      messageDeletionJobId: receipt.messageDeletionJobId,
      status: receipt.status,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
