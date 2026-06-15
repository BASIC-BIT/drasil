CREATE TYPE "role_quarantine_snapshot_status" AS ENUM (
  'active',
  'restored',
  'abandoned'
);

CREATE TABLE "role_quarantine_snapshots" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "user_id" text NOT NULL,
  "verification_event_id" uuid,
  "status" "role_quarantine_snapshot_status" NOT NULL DEFAULT 'active',
  "mode" text NOT NULL DEFAULT 'automatic',
  "original_role_ids" text[] NOT NULL DEFAULT '{}',
  "planned_role_ids" text[] NOT NULL DEFAULT '{}',
  "removed_role_ids" text[] NOT NULL DEFAULT '{}',
  "restored_role_ids" text[] NOT NULL DEFAULT '{}',
  "skipped_roles" jsonb DEFAULT '[]',
  "failed_removals" jsonb DEFAULT '[]',
  "failed_restores" jsonb DEFAULT '[]',
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "restored_at" timestamptz(6),
  "restored_by" text,
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "role_quarantine_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "role_quarantine_snapshots_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "role_quarantine_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "role_quarantine_snapshots_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "role_quarantine_snapshots_active_user_key" ON "role_quarantine_snapshots"("server_id", "user_id") WHERE "status" = 'active';
CREATE INDEX "idx_role_quarantine_snapshots_server" ON "role_quarantine_snapshots"("server_id");
CREATE INDEX "idx_role_quarantine_snapshots_status" ON "role_quarantine_snapshots"("status");
CREATE INDEX "idx_role_quarantine_snapshots_user" ON "role_quarantine_snapshots"("user_id");
CREATE INDEX "idx_role_quarantine_snapshots_user_status" ON "role_quarantine_snapshots"("server_id", "user_id", "status");
CREATE INDEX "idx_role_quarantine_snapshots_verification" ON "role_quarantine_snapshots"("verification_event_id");

ALTER TABLE "public"."role_quarantine_snapshots" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."role_quarantine_snapshots" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."role_quarantine_snapshots" FROM authenticated;
  END IF;
END $$;
