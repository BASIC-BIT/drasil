CREATE INDEX IF NOT EXISTS "idx_detection_events_latest_verification"
  ON "detection_events"("latest_verification_event_id");
