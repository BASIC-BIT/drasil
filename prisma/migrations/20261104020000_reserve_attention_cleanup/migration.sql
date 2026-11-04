ALTER TABLE moderation_queue_items
  ADD COLUMN attention_cleanup_pending boolean NOT NULL DEFAULT false;

-- Retire only the ordinary row's source identity. Keep existing unique indexes and
-- their conflict predicates compatible with the deployed application and rollback.
ALTER TABLE moderation_queue_items
  DROP CONSTRAINT moderation_queue_items_identity_required,
  ADD CONSTRAINT moderation_queue_items_identity_required CHECK (
    (NOT attention_cleanup_pending AND (
      (item_type = 'case_mirror' AND verification_event_id IS NOT NULL) OR
      (item_type = 'observed_alert_mirror' AND detection_event_id IS NOT NULL) OR
      (item_type IN ('support_thread_attention', 'report_thread_attention') AND source_thread_id IS NOT NULL) OR
      item_type = 'pending_screening_member' OR
      (item_type = 'quarantine_breach_attention' AND verification_event_id IS NOT NULL AND source_thread_id IS NOT NULL)
    )) OR (
      attention_cleanup_pending
      AND item_type IN ('support_thread_attention', 'report_thread_attention', 'quarantine_breach_attention')
      AND verification_event_id IS NULL AND detection_event_id IS NULL AND source_thread_id IS NULL
      AND COALESCE(
        jsonb_typeof(metadata->'attention_cleanup') = 'object'
        AND jsonb_typeof(metadata#>'{attention_cleanup,source_thread_id}') = 'string'
        AND length(metadata#>>'{attention_cleanup,source_thread_id}') > 0
        AND jsonb_typeof(metadata#>'{attention_cleanup,verification_event_id}') IN ('string', 'null')
        AND jsonb_typeof(metadata#>'{attention_cleanup,detection_event_id}') IN ('string', 'null')
        AND (metadata#>>'{attention_cleanup,verification_event_id}' IS NULL OR
          (metadata#>>'{attention_cleanup,verification_event_id}')::uuid IS NOT NULL)
        AND (metadata#>>'{attention_cleanup,detection_event_id}' IS NULL OR
          (metadata#>>'{attention_cleanup,detection_event_id}')::uuid IS NOT NULL)
        AND (item_type <> 'quarantine_breach_attention' OR
          jsonb_typeof(metadata#>'{attention_cleanup,verification_event_id}') = 'string'), false)
    )
  );
