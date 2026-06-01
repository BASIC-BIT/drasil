ALTER TABLE "public"."report_intakes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."report_intake_evidence" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."report_intakes" FROM anon;
    REVOKE ALL ON TABLE "public"."report_intake_evidence" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."report_intakes" FROM authenticated;
    REVOKE ALL ON TABLE "public"."report_intake_evidence" FROM authenticated;
  END IF;
END $$;
