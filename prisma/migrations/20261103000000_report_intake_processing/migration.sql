ALTER TABLE report_intakes
  ADD COLUMN evidence_revision integer NOT NULL DEFAULT 0 CHECK (evidence_revision >= 0),
  ADD COLUMN analysis_revision integer NOT NULL DEFAULT 0 CHECK (analysis_revision >= 0),
  ADD COLUMN analysis_due_at timestamptz,
  ADD COLUMN analysis_started_at timestamptz,
  ADD COLUMN analysis_deadline_at timestamptz,
  ADD COLUMN analysis_lease_until timestamptz,
  ADD COLUMN analysis_lease_token uuid,
  ADD COLUMN analysis_attempts integer NOT NULL DEFAULT 0 CHECK (analysis_attempts BETWEEN 0 AND 2);

CREATE INDEX idx_report_intakes_analysis_due ON report_intakes (analysis_due_at)
  WHERE analysis_due_at IS NOT NULL
    AND status IN ('collecting_evidence', 'needs_reporter_confirmation', 'needs_admin_confirmation');
