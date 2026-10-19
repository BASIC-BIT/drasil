// Only a fresh explicit request may reset a completed no-op; the worker revalidates ownership.
export const completedNoopRetrySql = `(moderation_action_requests.status = 'completed'
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

// Fixed fragments for the existing upsert table and excluded row; all values stay parameterized.
export const completedNoopRetryResetSql = `requested_at = CASE WHEN ${completedNoopRetrySql} THEN now() ELSE moderation_action_requests.requested_at END,
          started_at = CASE WHEN ${completedNoopRetrySql} THEN null ELSE moderation_action_requests.started_at END,
          completed_at = CASE WHEN ${completedNoopRetrySql} THEN null ELSE moderation_action_requests.completed_at END,
          attempts = CASE WHEN ${completedNoopRetrySql} THEN 0 ELSE moderation_action_requests.attempts END`;

export const reportBanRetryResultSql = `CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetrySql} THEN '{}'::jsonb ELSE moderation_action_requests.result END`;

export const reportBanRetryMetadataSql = `CASE WHEN (moderation_action_requests.action_type = 'ban_observed_detection' AND moderation_action_requests.status = 'failed') OR ${completedNoopRetrySql}
              THEN (SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM jsonb_each(coalesce(moderation_action_requests.metadata, '{}'::jsonb)) WHERE key !~ '^report_ban_') || (excluded.metadata - 'observed_ban_reviews')
              ELSE coalesce(moderation_action_requests.metadata, '{}'::jsonb) || (CASE WHEN moderation_action_requests.action_type = 'ban_observed_detection' THEN excluded.metadata - 'observed_ban_reviews' ELSE excluded.metadata END - 'report_ban_attempt_token') END`;
