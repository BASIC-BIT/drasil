import type { Pool, PoolClient } from 'pg';
import { getPostgresPool } from './setupDataAdapter';

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
  | 'upsert_report_instructions';

export type ModerationActionRequestQueueStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface ModerationActionRequestReceipt {
  readonly id: string;
  readonly messageDeletionJobId?: string | null;
  readonly status: ModerationActionRequestQueueStatus;
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

async function insertModerationActionRequestWithReceipt(
  client: Pool | PoolClient,
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestReceipt> {
  const result = await client.query<ModerationActionRequestReceipt>(
    `insert into moderation_action_requests (
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
       $11::jsonb
     )
     on conflict (idempotency_key) do update
     set status = case
           when moderation_action_requests.status in ('processing', 'completed')
             then moderation_action_requests.status
           else 'queued'
         end,
         updated_at = now(),
         failed_at = null,
         last_error = null,
         metadata = coalesce(moderation_action_requests.metadata, '{}'::jsonb) || excluded.metadata,
         message_deletion_job_id = coalesce(
           moderation_action_requests.message_deletion_job_id,
           excluded.message_deletion_job_id
         )
     returning
       id::text,
       message_deletion_job_id::text as "messageDeletionJobId",
       status::text as status`,
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

    const active = await client.query<ModerationActionRequestReceipt>(
      `select
         id::text,
         message_deletion_job_id::text as "messageDeletionJobId",
         status::text as status
       from moderation_action_requests
       where server_id = $1
         and action_type = $2::moderation_action_request_type
         and status in ('queued', 'processing')
       order by requested_at asc
       limit 1`,
      [input.serverId, input.actionType]
    );

    const receipt =
      active.rows[0] ?? (await insertModerationActionRequestWithReceipt(client, input));
    await client.query('commit');
    return receipt;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
