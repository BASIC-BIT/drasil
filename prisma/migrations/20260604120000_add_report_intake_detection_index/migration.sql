CREATE INDEX IF NOT EXISTS "idx_detection_events_report_intake_id"
  ON "detection_events" ((metadata #>> '{reportIntakeId}'), "detected_at" DESC)
  WHERE metadata ? 'reportIntakeId';
