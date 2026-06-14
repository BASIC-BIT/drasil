CREATE TYPE "moderation_queue_item_type" AS ENUM (
  'case_mirror',
  'observed_alert_mirror',
  'support_thread_attention',
  'report_thread_attention'
);

CREATE TABLE "moderation_queue_items" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "user_id" text NOT NULL,
  "item_type" "moderation_queue_item_type" NOT NULL,
  "verification_event_id" uuid,
  "detection_event_id" uuid,
  "report_intake_id" uuid,
  "source_thread_id" text,
  "queue_channel_id" text,
  "queue_message_id" text,
  "last_source_message_id" text,
  "last_notified_at" timestamptz(6),
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "moderation_queue_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "moderation_queue_items_identity_required" CHECK (
    ("item_type" = 'case_mirror' AND "verification_event_id" IS NOT NULL) OR
    ("item_type" = 'observed_alert_mirror' AND "detection_event_id" IS NOT NULL) OR
    ("item_type" IN ('support_thread_attention', 'report_thread_attention') AND "source_thread_id" IS NOT NULL)
  ),
  CONSTRAINT "moderation_queue_items_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_queue_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_queue_items_verification_event_id_fkey" FOREIGN KEY ("verification_event_id") REFERENCES "verification_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_queue_items_detection_event_id_fkey" FOREIGN KEY ("detection_event_id") REFERENCES "detection_events"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "moderation_queue_items_report_intake_id_fkey" FOREIGN KEY ("report_intake_id") REFERENCES "report_intakes"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "moderation_queue_items_type_verification_key" ON "moderation_queue_items"("item_type", "verification_event_id") WHERE "verification_event_id" IS NOT NULL;
CREATE UNIQUE INDEX "moderation_queue_items_type_detection_key" ON "moderation_queue_items"("item_type", "detection_event_id") WHERE "detection_event_id" IS NOT NULL;
CREATE UNIQUE INDEX "moderation_queue_items_type_thread_key" ON "moderation_queue_items"("item_type", "source_thread_id") WHERE "source_thread_id" IS NOT NULL;
CREATE INDEX "idx_moderation_queue_items_detection" ON "moderation_queue_items"("detection_event_id");
CREATE INDEX "idx_moderation_queue_items_type" ON "moderation_queue_items"("item_type");
CREATE INDEX "idx_moderation_queue_items_queue_message" ON "moderation_queue_items"("queue_channel_id", "queue_message_id");
CREATE INDEX "idx_moderation_queue_items_report_intake" ON "moderation_queue_items"("report_intake_id");
CREATE INDEX "idx_moderation_queue_items_server" ON "moderation_queue_items"("server_id");
CREATE INDEX "idx_moderation_queue_items_thread" ON "moderation_queue_items"("source_thread_id");
CREATE INDEX "idx_moderation_queue_items_user" ON "moderation_queue_items"("user_id");
CREATE INDEX "idx_moderation_queue_items_verification" ON "moderation_queue_items"("verification_event_id");

ALTER TABLE "public"."moderation_queue_items" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."moderation_queue_items" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."moderation_queue_items" FROM authenticated;
  END IF;
END $$;
