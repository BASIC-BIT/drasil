CREATE TYPE "moderation_outcome_source" AS ENUM (
  'drasil',
  'native_discord',
  'external_bot',
  'unknown_external',
  'migration_or_sync'
);

CREATE TYPE "moderation_outcome_type" AS ENUM (
  'restricted',
  'verified',
  'banned',
  'member_left'
);

CREATE TABLE "moderation_outcomes" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "user_id" text NOT NULL,
  "detection_event_id" uuid,
  "verification_event_id" uuid,
  "outcome_type" "moderation_outcome_type" NOT NULL,
  "source" "moderation_outcome_source" NOT NULL,
  "actor_id" text,
  "reason" text,
  "occurred_at" timestamptz(6) DEFAULT now(),
  "created_at" timestamptz(6) DEFAULT now(),
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "moderation_outcomes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_outcomes_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_outcomes_detection_event_id_fkey" FOREIGN KEY ("detection_event_id") REFERENCES "detection_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "moderation_outcomes_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_moderation_outcomes_actor" ON "moderation_outcomes"("actor_id");
CREATE INDEX "idx_moderation_outcomes_detection" ON "moderation_outcomes"("detection_event_id");
CREATE INDEX "idx_moderation_outcomes_occurred_at" ON "moderation_outcomes"("occurred_at");
CREATE INDEX "idx_moderation_outcomes_type" ON "moderation_outcomes"("outcome_type");
CREATE INDEX "idx_moderation_outcomes_server" ON "moderation_outcomes"("server_id");
CREATE INDEX "idx_moderation_outcomes_source" ON "moderation_outcomes"("source");
CREATE INDEX "idx_moderation_outcomes_user" ON "moderation_outcomes"("user_id");
CREATE INDEX "idx_moderation_outcomes_user_server_type" ON "moderation_outcomes"("user_id", "server_id", "outcome_type");
CREATE INDEX "idx_moderation_outcomes_verification" ON "moderation_outcomes"("verification_event_id");

ALTER TABLE "public"."moderation_outcomes" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."moderation_outcomes" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."moderation_outcomes" FROM authenticated;
  END IF;
END $$;
