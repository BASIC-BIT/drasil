ALTER TABLE "public"."admin_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."detection_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."server_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."servers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verification_events" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."admin_actions" FROM anon;
    REVOKE ALL ON TABLE "public"."detection_events" FROM anon;
    REVOKE ALL ON TABLE "public"."server_members" FROM anon;
    REVOKE ALL ON TABLE "public"."servers" FROM anon;
    REVOKE ALL ON TABLE "public"."users" FROM anon;
    REVOKE ALL ON TABLE "public"."verification_events" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."admin_actions" FROM authenticated;
    REVOKE ALL ON TABLE "public"."detection_events" FROM authenticated;
    REVOKE ALL ON TABLE "public"."server_members" FROM authenticated;
    REVOKE ALL ON TABLE "public"."servers" FROM authenticated;
    REVOKE ALL ON TABLE "public"."users" FROM authenticated;
    REVOKE ALL ON TABLE "public"."verification_events" FROM authenticated;
  END IF;
END $$;
