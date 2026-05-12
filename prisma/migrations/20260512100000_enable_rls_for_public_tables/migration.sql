ALTER TABLE "public"."admin_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."detection_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."server_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."servers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."verification_events" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."admin_actions" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."detection_events" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."server_members" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."servers" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."users" FROM anon, authenticated;
REVOKE ALL ON TABLE "public"."verification_events" FROM anon, authenticated;
