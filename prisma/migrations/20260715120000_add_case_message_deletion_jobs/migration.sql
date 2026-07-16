CREATE TYPE "message_deletion_job_mode" AS ENUM (
  'delete_only',
  'ban_with_cleanup'
);

CREATE TYPE "message_deletion_ban_status" AS ENUM (
  'not_requested',
  'pending',
  'succeeded',
  'failed'
);

CREATE TYPE "message_deletion_case_finalization_status" AS ENUM (
  'not_applicable',
  'pending',
  'succeeded',
  'failed'
);

CREATE TYPE "message_deletion_scope" AS ENUM (
  'source_message',
  'last_hour',
  'last_day',
  'last_7_days'
);

CREATE TYPE "message_deletion_job_status" AS ENUM (
  'queued',
  'discovering',
  'ready',
  'executing',
  'completed',
  'failed'
);

CREATE TYPE "message_deletion_coverage" AS ENUM (
  'ready',
  'partial',
  'indexing',
  'denied',
  'unavailable',
  'too_many'
);

CREATE TYPE "message_deletion_discovery_source" AS ENUM (
  'source_message',
  'discord_search',
  'message_context'
);

CREATE TYPE "message_deletion_evidence_status" AS ENUM (
  'pending',
  'preserved',
  'failed'
);

CREATE TYPE "message_deletion_item_status" AS ENUM (
  'pending',
  'deleted',
  'already_missing',
  'changed_since_preview',
  'evidence_failed',
  'delete_failed',
  'permission_denied'
);

CREATE TABLE "message_deletion_jobs" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "user_id" text NOT NULL,
  "verification_event_id" uuid NOT NULL,
  "requested_by" text NOT NULL,
  "actor_surface" text NOT NULL,
  "mode" "message_deletion_job_mode" NOT NULL,
  "ban_status" "message_deletion_ban_status" NOT NULL DEFAULT 'not_requested',
  "case_finalization_status" "message_deletion_case_finalization_status" NOT NULL DEFAULT 'not_applicable',
  "scope" "message_deletion_scope" NOT NULL,
  "status" "message_deletion_job_status" NOT NULL DEFAULT 'queued',
  "coverage" "message_deletion_coverage",
  "reason" text NOT NULL,
  "evidence_thread_id" text NOT NULL,
  "requested_window_start" timestamptz(6),
  "requested_window_end" timestamptz(6),
  "previewed_at" timestamptz(6),
  "started_at" timestamptz(6),
  "completed_at" timestamptz(6),
  "failed_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  "candidate_count" integer NOT NULL DEFAULT 0,
  "preserved_count" integer NOT NULL DEFAULT 0,
  "deleted_count" integer NOT NULL DEFAULT 0,
  "already_missing_count" integer NOT NULL DEFAULT 0,
  "changed_count" integer NOT NULL DEFAULT 0,
  "evidence_failed_count" integer NOT NULL DEFAULT 0,
  "delete_failed_count" integer NOT NULL DEFAULT 0,
  "permission_denied_count" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "message_deletion_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_deletion_jobs_required_text" CHECK (
    length(btrim("server_id")) > 0 AND
    length(btrim("user_id")) > 0 AND
    length(btrim("requested_by")) > 0 AND
    length(btrim("actor_surface")) > 0 AND
    length(btrim("reason")) > 0 AND
    length(btrim("reason")) <= 1000 AND
    length(btrim("evidence_thread_id")) > 0
  ),
  CONSTRAINT "message_deletion_jobs_window_order" CHECK (
    "requested_window_start" IS NULL OR
    "requested_window_end" IS NULL OR
    "requested_window_start" <= "requested_window_end"
  ),
  CONSTRAINT "message_deletion_jobs_nonnegative_counts" CHECK (
    "candidate_count" >= 0 AND
    "preserved_count" >= 0 AND
    "deleted_count" >= 0 AND
    "already_missing_count" >= 0 AND
    "changed_count" >= 0 AND
    "evidence_failed_count" >= 0 AND
    "delete_failed_count" >= 0 AND
    "permission_denied_count" >= 0
  ),
  CONSTRAINT "message_deletion_jobs_candidate_cap" CHECK ("candidate_count" <= 500),
  CONSTRAINT "message_deletion_jobs_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "message_deletion_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "message_deletion_jobs_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX "idx_message_deletion_jobs_status" ON "message_deletion_jobs"("server_id", "status", "created_at");
CREATE INDEX "idx_message_deletion_jobs_user" ON "message_deletion_jobs"("user_id");
CREATE INDEX "idx_message_deletion_jobs_verification" ON "message_deletion_jobs"("verification_event_id");

CREATE TABLE "message_deletion_items" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "job_id" uuid NOT NULL,
  "message_id" text NOT NULL,
  "channel_id" text NOT NULL,
  "author_id" text NOT NULL,
  "message_created_at" timestamptz(6) NOT NULL,
  "message_edited_at" timestamptz(6),
  "content_preview" text NOT NULL,
  "attachment_count" integer NOT NULL DEFAULT 0,
  "discovery_source" "message_deletion_discovery_source" NOT NULL,
  "bulk_delete_eligible" boolean NOT NULL DEFAULT false,
  "evidence_status" "message_deletion_evidence_status" NOT NULL DEFAULT 'pending',
  "status" "message_deletion_item_status" NOT NULL DEFAULT 'pending',
  "evidence_message_id" text,
  "attempted_at" timestamptz(6),
  "evidence_preserved_at" timestamptz(6),
  "deleted_at" timestamptz(6),
  "completed_at" timestamptz(6),
  "failure_reason" text,
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "message_deletion_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_deletion_items_required_text" CHECK (
    length(btrim("message_id")) > 0 AND
    length(btrim("channel_id")) > 0 AND
    length(btrim("author_id")) > 0
  ),
  CONSTRAINT "message_deletion_items_preview_length" CHECK (length("content_preview") <= 500),
  CONSTRAINT "message_deletion_items_attachment_count" CHECK ("attachment_count" >= 0),
  CONSTRAINT "message_deletion_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "message_deletion_jobs"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "message_deletion_items_job_message_key" ON "message_deletion_items"("job_id", "message_id");
CREATE INDEX "idx_message_deletion_items_channel_bulk" ON "message_deletion_items"("channel_id", "bulk_delete_eligible");
CREATE INDEX "idx_message_deletion_items_job_status" ON "message_deletion_items"("job_id", "status");
CREATE INDEX "idx_message_deletion_items_message" ON "message_deletion_items"("message_id");

ALTER TABLE "moderation_action_requests"
  ADD COLUMN "message_deletion_job_id" uuid,
  ADD CONSTRAINT "moderation_action_requests_message_deletion_job_id_fkey"
    FOREIGN KEY ("message_deletion_job_id") REFERENCES "message_deletion_jobs"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "idx_moderation_action_requests_message_deletion_job" ON "moderation_action_requests"("message_deletion_job_id");

WITH ranked_active_case_requests AS (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "verification_event_id"
           ORDER BY
             CASE WHEN "status" = 'processing' THEN 0 ELSE 1 END,
             "requested_at" ASC NULLS LAST,
             "id" ASC
         ) AS active_rank
  FROM "moderation_action_requests"
  WHERE "verification_event_id" IS NOT NULL
    AND "status" IN ('queued', 'processing')
)
UPDATE "moderation_action_requests" AS requests
SET "status" = 'failed',
    "failed_at" = now(),
    "updated_at" = now(),
    "last_error" = 'Superseded while enabling per-case moderation action serialization.'
FROM ranked_active_case_requests AS ranked
WHERE requests."id" = ranked."id"
  AND ranked.active_rank > 1;

CREATE UNIQUE INDEX "moderation_action_requests_one_active_case_request"
  ON "moderation_action_requests"("verification_event_id")
  WHERE "verification_event_id" IS NOT NULL
    AND "status" IN ('queued', 'processing');

ALTER TABLE "moderation_action_requests" DROP CONSTRAINT "moderation_action_requests_required_targets";
ALTER TABLE "moderation_action_requests" ADD CONSTRAINT "moderation_action_requests_required_targets" CHECK (
  (
    "action_type" NOT IN (
      'open_case_from_observed_detection',
      'dismiss_observed_detection',
      'mark_observed_detection_false_positive',
      'undo_observed_detection_action',
      'kick_observed_detection',
      'ban_observed_detection'
    ) OR
    ("target_user_id" IS NOT NULL AND "detection_event_id" IS NOT NULL)
  ) AND (
    "action_type" NOT IN ('open_admin_case', 'manual_flag_user', 'submit_user_report') OR
    "target_user_id" IS NOT NULL
  ) AND (
    "action_type" NOT IN ('ignore_detection_accounting', 'restore_detection_accounting') OR
    "detection_event_id" IS NOT NULL
  ) AND (
    "action_type" NOT IN ('close_report_intake') OR
    "report_intake_id" IS NOT NULL
  ) AND (
    "action_type" NOT IN ('verify_case_user', 'close_case_no_action', 'kick_case_user', 'ban_case_user', 'ban_case_user_by_id', 'repair_active_case', 'reopen_case', 'refresh_case_notification', 'sync_existing_ban') OR
    ("target_user_id" IS NOT NULL AND "verification_event_id" IS NOT NULL)
  ) AND (
    "action_type" NOT IN ('preview_case_message_deletion', 'execute_case_message_deletion', 'ban_case_user_with_message_cleanup') OR
    ("target_user_id" IS NOT NULL AND "verification_event_id" IS NOT NULL AND "message_deletion_job_id" IS NOT NULL)
  )
);

ALTER TABLE "public"."message_deletion_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."message_deletion_items" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."message_deletion_jobs" FROM anon;
    REVOKE ALL ON TABLE "public"."message_deletion_items" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."message_deletion_jobs" FROM authenticated;
    REVOKE ALL ON TABLE "public"."message_deletion_items" FROM authenticated;
  END IF;
END $$;
