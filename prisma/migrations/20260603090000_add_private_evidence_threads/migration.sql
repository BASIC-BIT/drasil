ALTER TABLE public.verification_events
  ADD COLUMN IF NOT EXISTS private_evidence_thread_id text;

CREATE INDEX IF NOT EXISTS idx_verification_events_private_evidence_thread
  ON public.verification_events(private_evidence_thread_id);
