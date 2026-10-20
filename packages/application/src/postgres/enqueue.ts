import type { EnqueueInput } from '../requests/receipt';

// These columns identify the operation, even when a fresh report-ban attempt is admitted.
const sameBinding = [
  'server_id',
  'action_type',
  'target_user_id',
  'detection_event_id',
  'report_intake_id',
  'verification_event_id',
  'message_deletion_job_id',
]
  .map((column) => `moderation_action_requests.${column} IS NOT DISTINCT FROM excluded.${column}`)
  .join(' AND ');

// An exact no-op can be retried only after its subject becomes eligible and unowned.
const completedNoopRetry = `(moderation_action_requests.status = 'completed'
  AND moderation_action_requests.action_type = 'ban_observed_detection'
  AND moderation_action_requests.result->'observed_ban_result' = '{"status":"already_handled"}'::jsonb
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
// An operator's persisted absence review archives the previous uncertain attempt.
// Only that bound terminal disposition can release its historical enforcement IDs.
// Incoming metadata never supplies evidence for this exception.
const reviewedAbsent = `coalesce((
  moderation_action_requests.status = 'failed'
  AND moderation_action_requests.result->'observed_ban_result' = jsonb_build_object(
    'status', 'ban_reviewed_no_current_ban', 'operationId', moderation_action_requests.id::text)
  AND moderation_action_requests.metadata->'observed_ban_reviews'->-1->>'operation_id' = moderation_action_requests.id::text
  AND moderation_action_requests.metadata->'observed_ban_reviews'->-1->>'disposition' = 'no_current_ban_historical_outcome_uncertain'
  AND moderation_action_requests.metadata->'observed_ban_reviews'->-1->'result'->'observed_ban_result'->>'status' = 'ban_outcome_unknown'
  AND moderation_action_requests.metadata->'observed_ban_reviews'->-1->'operation_metadata'->>'report_ban_phase' = 'reconciliation_required'
  AND moderation_action_requests.metadata->'observed_ban_reviews'->-1->>'attempt_token' = moderation_action_requests.metadata->'observed_ban_reviews'->-1->'operation_metadata'->>'report_ban_attempt_token'
  AND moderation_action_requests.metadata->>'report_ban_attempt_token' <> moderation_action_requests.metadata->'observed_ban_reviews'->-1->>'attempt_token'
  AND moderation_action_requests.metadata->>'report_ban_enforcement_id' IS NOT DISTINCT FROM moderation_action_requests.metadata->'observed_ban_reviews'->-1->'operation_metadata'->>'report_ban_enforcement_id'
  AND moderation_action_requests.metadata->>'report_ban_enforcement_operation_id' IS NOT DISTINCT FROM moderation_action_requests.metadata->'observed_ban_reviews'->-1->'operation_metadata'->>'report_ban_enforcement_operation_id'
), false)`;
const protectedReportBan = `(moderation_action_requests.action_type = 'ban_observed_detection' AND (
  moderation_action_requests.metadata->>'report_ban_phase' IS NOT NULL
  OR moderation_action_requests.metadata->>'report_ban_confirmed_at' IS NOT NULL
  OR coalesce(moderation_action_requests.result->'observed_ban_result'->>'status', '') IN ('banned', 'banned_updates_pending', 'ban_outcome_unknown')
  OR ((moderation_action_requests.metadata->>'report_ban_enforcement_id' IS NOT NULL
    OR moderation_action_requests.metadata->>'report_ban_enforcement_operation_id' IS NOT NULL)
    AND NOT ${reviewedAbsent})
))`;

const text = `insert into moderation_action_requests (
  server_id, action_type, status, actor_id, actor_surface, target_user_id,
  detection_event_id, report_intake_id, verification_event_id, message_deletion_job_id,
  idempotency_key, metadata
) values (
  $1, $2::moderation_action_request_type, 'queued', $3, $4, $5,
  $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10,
  $11::jsonb || CASE WHEN $2 = 'ban_observed_detection'
    THEN jsonb_build_object('report_ban_attempt_token', gen_random_uuid()::text) ELSE '{}'::jsonb END
)
on conflict (idempotency_key) do update
set (status, updated_at, requested_at, started_at, completed_at, attempts,
     failed_at, last_error, actor_id, actor_surface, result, metadata) = (
  SELECT
    CASE WHEN mutable THEN 'queued'::moderation_action_request_status ELSE moderation_action_requests.status END,
    CASE WHEN mutable THEN now() ELSE moderation_action_requests.updated_at END,
    CASE WHEN mutable AND retry_noop THEN now() ELSE moderation_action_requests.requested_at END,
    CASE WHEN mutable AND retry_noop THEN null ELSE moderation_action_requests.started_at END,
    CASE WHEN mutable AND retry_noop THEN null ELSE moderation_action_requests.completed_at END,
    CASE WHEN mutable AND retry_noop THEN 0 ELSE moderation_action_requests.attempts END,
    CASE WHEN mutable THEN null ELSE moderation_action_requests.failed_at END,
    CASE WHEN mutable THEN null ELSE moderation_action_requests.last_error END,
    CASE WHEN mutable AND new_attempt THEN excluded.actor_id ELSE moderation_action_requests.actor_id END,
    CASE WHEN mutable AND new_attempt THEN excluded.actor_surface ELSE moderation_action_requests.actor_surface END,
    CASE WHEN mutable AND new_attempt THEN '{}'::jsonb ELSE moderation_action_requests.result END,
    CASE WHEN NOT mutable THEN moderation_action_requests.metadata
      WHEN new_attempt THEN (
        SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
        FROM jsonb_each(coalesce(moderation_action_requests.metadata, '{}'::jsonb)) WHERE key !~ '^report_ban_'
      ) || (excluded.metadata - 'observed_ban_reviews')
      ELSE coalesce(moderation_action_requests.metadata, '{}'::jsonb) ||
        (CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection'
          THEN excluded.metadata - 'observed_ban_reviews' ELSE excluded.metadata END - 'report_ban_attempt_token')
    END
  FROM (SELECT ${sameBinding} AS same_binding,
    coalesce(${completedNoopRetry}, false) AS retry_noop,
    ${protectedReportBan} AS protected) AS binding
  CROSS JOIN LATERAL (SELECT (retry_noop OR (
    moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed'
  )) AS new_attempt) AS attempt
  CROSS JOIN LATERAL (SELECT same_binding AND NOT protected AND (
    new_attempt OR (
      moderation_action_requests.actor_id = excluded.actor_id
      AND moderation_action_requests.actor_surface = excluded.actor_surface
      AND (moderation_action_requests.status = 'failed' OR (
        moderation_action_requests.status = 'queued' AND moderation_action_requests.action_type <> 'apply_captcha_pass'
      ))
    )
  ) AS mutable) AS policy
)
returning *`;

/** Both clients execute this statement in their existing transaction. Conflicts always
 * return the locked row, including an unchanged protected receipt. Unlike a CTE
 * SELECT fallback, this also sees a competing insert committed after our snapshot. */
export function buildEnqueueStatement(input: EnqueueInput): {
  text: string;
  values: readonly unknown[];
} {
  return {
    text,
    values: [
      input.serverId,
      input.actionType,
      input.actorId,
      input.actorSurface,
      input.targetUserId,
      input.detectionEventId ?? null,
      input.reportIntakeId ?? null,
      input.verificationEventId ?? null,
      input.messageDeletionJobId ?? null,
      input.idempotencyKey,
      JSON.stringify(input.metadata),
    ],
  };
}
