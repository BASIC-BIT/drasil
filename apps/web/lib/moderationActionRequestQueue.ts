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
  | 'close_case_no_action'
  | 'kick_case_user'
  | 'ban_case_user'
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

export interface QueueModerationActionRequestInput {
  readonly actionType: ModerationActionRequestActionType;
  readonly actorId: string;
  readonly actorSurface: string;
  readonly detectionEventId?: string | null;
  readonly idempotencyKey: string;
  readonly metadata?: Record<string, unknown>;
  readonly reportIntakeId?: string | null;
  readonly serverId: string;
  readonly targetUserId?: string | null;
  readonly verificationEventId?: string | null;
}

export async function queueModerationActionRequest(
  input: QueueModerationActionRequestInput
): Promise<ModerationActionRequestQueueStatus> {
  const result = await getPostgresPool().query<{
    status: ModerationActionRequestQueueStatus;
  }>(
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
       $9,
       $10::jsonb
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
         metadata = coalesce(moderation_action_requests.metadata, '{}'::jsonb) || excluded.metadata
     returning status`,
    [
      input.serverId,
      input.actionType,
      input.actorId,
      input.actorSurface,
      input.targetUserId ?? null,
      input.detectionEventId ?? null,
      input.reportIntakeId ?? null,
      input.verificationEventId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.metadata ?? {}),
    ]
  );

  return result.rows[0]?.status ?? 'failed';
}
