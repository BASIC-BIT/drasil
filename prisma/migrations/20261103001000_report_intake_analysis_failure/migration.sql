ALTER TABLE report_intakes
  ADD COLUMN analysis_failure_code text CHECK (analysis_failure_code IN ('invalid_metadata'));
