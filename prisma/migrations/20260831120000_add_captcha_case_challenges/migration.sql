CREATE TYPE "captcha_provider" AS ENUM ('turnstile');
CREATE TYPE "captcha_challenge_status" AS ENUM (
  'pending',
  'passed',
  'failed',
  'expired',
  'bypassed',
  'cancelled'
);
CREATE TYPE "captcha_challenge_request_source" AS ENUM (
  'moderator',
  'automatic_suspicious_join'
);
CREATE TYPE "captcha_challenge_pass_effect" AS ENUM (
  'evidence_only',
  'verify_join_only'
);
CREATE TYPE "captcha_attempt_validation_state" AS ENUM (
  'started',
  'identity_mismatch',
  'invalid',
  'passed',
  'provider_error',
  'stale'
);

ALTER TABLE "verification_events"
  ADD COLUMN "case_revision" integer NOT NULL DEFAULT 0;

CREATE TABLE "captcha_challenges" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "verification_event_id" uuid NOT NULL,
  "server_id" text NOT NULL,
  "user_id" text NOT NULL,
  "provider" "captcha_provider" NOT NULL DEFAULT 'turnstile',
  "status" "captcha_challenge_status" NOT NULL DEFAULT 'pending',
  "request_source" "captcha_challenge_request_source" NOT NULL,
  "pass_effect" "captcha_challenge_pass_effect" NOT NULL,
  "generation" integer NOT NULL DEFAULT 1,
  "case_revision_at_issue" integer NOT NULL,
  "link_token_hash" text NOT NULL,
  "expires_at" timestamptz(6) NOT NULL,
  "submission_count" integer NOT NULL DEFAULT 0,
  "requested_by" text,
  "requested_at" timestamptz(6) NOT NULL DEFAULT now(),
  "delivered_at" timestamptz(6),
  "delivery_error_code" text,
  "passed_at" timestamptz(6),
  "bypassed_by" text,
  "bypassed_at" timestamptz(6),
  "bypass_reason" text,
  "cancelled_at" timestamptz(6),
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "updated_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "captcha_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "captcha_challenges_generation_positive" CHECK ("generation" > 0),
  CONSTRAINT "captcha_challenges_revision_nonnegative" CHECK ("case_revision_at_issue" >= 0),
  CONSTRAINT "captcha_challenges_submission_nonnegative" CHECK ("submission_count" >= 0),
  CONSTRAINT "captcha_challenges_token_hash_nonempty" CHECK (length(btrim("link_token_hash")) > 0),
  CONSTRAINT "captcha_challenges_delivery_error_bounded" CHECK ("delivery_error_code" IS NULL OR length("delivery_error_code") <= 100),
  CONSTRAINT "captcha_challenges_bypass_reason_bounded" CHECK (
    "bypass_reason" IS NULL OR
    (length(btrim("bypass_reason")) > 0 AND length("bypass_reason") <= 1000)
  ),
  CONSTRAINT "captcha_challenges_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "captcha_challenges_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "captcha_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "captcha_challenges_verification_event_id_key"
  ON "captcha_challenges"("verification_event_id");
CREATE UNIQUE INDEX "captcha_challenges_link_token_hash_key"
  ON "captcha_challenges"("link_token_hash");
CREATE INDEX "idx_captcha_challenges_server_status_expiry"
  ON "captcha_challenges"("server_id", "status", "expires_at");
CREATE INDEX "idx_captcha_challenges_user_server"
  ON "captcha_challenges"("user_id", "server_id");

CREATE TABLE "captcha_challenge_attempts" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "captcha_challenge_id" uuid NOT NULL,
  "generation" integer NOT NULL,
  "submission_number" integer NOT NULL,
  "consumes_submission" boolean NOT NULL DEFAULT true,
  "idempotency_key" text NOT NULL,
  "validation_state" "captcha_attempt_validation_state" NOT NULL,
  "provider_success" boolean,
  "provider_action" text,
  "provider_hostname" text,
  "provider_error_codes" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "discord_user_id" text,
  "created_at" timestamptz(6) NOT NULL DEFAULT now(),
  "validated_at" timestamptz(6),
  CONSTRAINT "captcha_challenge_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "captcha_attempts_generation_positive" CHECK ("generation" > 0),
  CONSTRAINT "captcha_attempts_submission_positive" CHECK ("submission_number" > 0),
  CONSTRAINT "captcha_attempts_idempotency_nonempty" CHECK (length(btrim("idempotency_key")) > 0),
  CONSTRAINT "captcha_attempts_provider_action_bounded" CHECK ("provider_action" IS NULL OR length("provider_action") <= 100),
  CONSTRAINT "captcha_attempts_provider_hostname_bounded" CHECK ("provider_hostname" IS NULL OR length("provider_hostname") <= 255),
  CONSTRAINT "captcha_attempts_provider_errors_bounded" CHECK (cardinality("provider_error_codes") <= 12),
  CONSTRAINT "captcha_attempts_challenge_id_fkey" FOREIGN KEY ("captcha_challenge_id") REFERENCES "captcha_challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "captcha_challenge_attempts_idempotency_key_key"
  ON "captcha_challenge_attempts"("idempotency_key");
CREATE UNIQUE INDEX "captcha_attempts_generation_submission_key"
  ON "captcha_challenge_attempts"("captcha_challenge_id", "generation", "submission_number");
CREATE INDEX "idx_captcha_attempts_challenge_generation"
  ON "captcha_challenge_attempts"("captcha_challenge_id", "generation");

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
    "action_type" NOT IN (
      'verify_case_user',
      'close_case_no_action',
      'kick_case_user',
      'ban_case_user',
      'ban_case_user_by_id',
      'repair_active_case',
      'reopen_case',
      'refresh_case_notification',
      'sync_existing_ban',
      'request_captcha_challenge',
      'retry_captcha_challenge',
      'bypass_captcha_challenge',
      'apply_captcha_pass',
      'notify_captcha_attention'
    ) OR
    ("target_user_id" IS NOT NULL AND "verification_event_id" IS NOT NULL)
  ) AND (
    "action_type" NOT IN ('preview_case_message_deletion', 'execute_case_message_deletion', 'ban_case_user_with_message_cleanup') OR
    ("target_user_id" IS NOT NULL AND "verification_event_id" IS NOT NULL AND "message_deletion_job_id" IS NOT NULL)
  )
);

ALTER TABLE "public"."captcha_challenges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."captcha_challenge_attempts" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenges" FROM anon;
    REVOKE ALL ON TABLE "public"."captcha_challenge_attempts" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenges" FROM authenticated;
    REVOKE ALL ON TABLE "public"."captcha_challenge_attempts" FROM authenticated;
  END IF;
END $$;
