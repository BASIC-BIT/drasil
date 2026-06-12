ALTER TABLE "verification_events"
  ADD COLUMN IF NOT EXISTS "notification_channel_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_verification_events_notification_channel"
  ON "verification_events"("notification_channel_id");
