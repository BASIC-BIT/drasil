CREATE TABLE "captcha_challenge_requests" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "captcha_challenge_id" uuid NOT NULL,
  "generation" integer NOT NULL,
  "request_source" "captcha_challenge_request_source" NOT NULL,
  "pass_effect" "captcha_challenge_pass_effect" NOT NULL,
  "case_revision_at_issue" integer NOT NULL,
  "requested_by" text,
  "requested_at" timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT "captcha_challenge_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "captcha_requests_generation_positive" CHECK ("generation" > 0),
  CONSTRAINT "captcha_requests_revision_nonnegative" CHECK ("case_revision_at_issue" >= 0),
  CONSTRAINT "captcha_challenge_requests_challenge_id_fkey" FOREIGN KEY ("captcha_challenge_id") REFERENCES "captcha_challenges"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

INSERT INTO "captcha_challenge_requests" (
  "captcha_challenge_id",
  "generation",
  "request_source",
  "pass_effect",
  "case_revision_at_issue",
  "requested_by",
  "requested_at"
)
SELECT
  "id",
  "generation",
  "request_source",
  "pass_effect",
  "case_revision_at_issue",
  "requested_by",
  "requested_at"
FROM "captcha_challenges";

CREATE UNIQUE INDEX "captcha_requests_challenge_generation_key"
  ON "captcha_challenge_requests"("captcha_challenge_id", "generation");
CREATE INDEX "idx_captcha_requests_challenge_time"
  ON "captcha_challenge_requests"("captcha_challenge_id", "requested_at");

ALTER TABLE "public"."captcha_challenge_requests" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenge_requests" FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."captcha_challenge_requests" FROM authenticated;
  END IF;
END $$;
