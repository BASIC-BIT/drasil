CREATE TYPE "moderation_action_request_type" AS ENUM (
  'open_case_from_observed_detection',
  'open_admin_case',
  'manual_flag_user',
  'submit_user_report',
  'start_report_intake',
  'close_report_intake',
  'dismiss_observed_detection',
  'mark_observed_detection_false_positive',
  'undo_observed_detection_action',
  'kick_observed_detection',
  'ban_observed_detection',
  'ignore_detection_accounting',
  'restore_detection_accounting',
  'verify_case_user',
  'close_case_no_action',
  'kick_case_user',
  'ban_case_user',
  'ban_case_user_by_id',
  'repair_active_case',
  'reopen_case',
  'refresh_case_notification',
  'sync_moderation_queue',
  'clear_moderation_queue',
  'close_resolved_case_threads',
  'audit_case_role_lockdown',
  'apply_case_role_lockdown',
  'intake_role_members',
  'sync_existing_ban',
  'complete_setup_verification',
  'upsert_report_instructions'
);

CREATE TYPE "moderation_action_request_status" AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed'
);

CREATE TABLE "moderation_action_requests" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "action_type" "moderation_action_request_type" NOT NULL,
  "status" "moderation_action_request_status" NOT NULL DEFAULT 'queued',
  "actor_id" text NOT NULL,
  "actor_surface" text NOT NULL,
  "target_user_id" text,
  "detection_event_id" uuid,
  "report_intake_id" uuid,
  "verification_event_id" uuid,
  "idempotency_key" text NOT NULL,
  "requested_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "started_at" timestamptz(6),
  "completed_at" timestamptz(6),
  "failed_at" timestamptz(6),
  "attempts" integer NOT NULL DEFAULT 0,
  "last_error" text,
  "metadata" jsonb DEFAULT '{}',
  "result" jsonb DEFAULT '{}',
  CONSTRAINT "moderation_action_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_action_requests_required_targets" CHECK (
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
    )
  ),
  CONSTRAINT "moderation_action_requests_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_action_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("discord_id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "moderation_action_requests_detection_event_id_fkey" FOREIGN KEY ("detection_event_id") REFERENCES "detection_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "moderation_action_requests_report_intake_id_fkey" FOREIGN KEY ("report_intake_id") REFERENCES "report_intakes"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "moderation_action_requests_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "moderation_action_requests_idempotency_key" ON "moderation_action_requests"("idempotency_key");
CREATE INDEX "idx_moderation_action_requests_action" ON "moderation_action_requests"("action_type");
CREATE INDEX "idx_moderation_action_requests_detection" ON "moderation_action_requests"("detection_event_id");
CREATE INDEX "idx_moderation_action_requests_report" ON "moderation_action_requests"("report_intake_id");
CREATE INDEX "idx_moderation_action_requests_status" ON "moderation_action_requests"("server_id", "status", "requested_at");
CREATE INDEX "idx_moderation_action_requests_target" ON "moderation_action_requests"("target_user_id");
CREATE INDEX "idx_moderation_action_requests_verification" ON "moderation_action_requests"("verification_event_id");

ALTER TABLE "public"."moderation_action_requests" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."moderation_action_requests" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."moderation_action_requests" FROM authenticated;
  END IF;
END $$;
