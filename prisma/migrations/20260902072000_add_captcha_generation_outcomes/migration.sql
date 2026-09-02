CREATE TYPE "captcha_challenge_request_outcome" AS ENUM (
  'delivery_failed',
  'failed',
  'expired',
  'bypassed',
  'cancelled'
);

ALTER TABLE "captcha_challenge_requests"
  ADD COLUMN "outcome" "captcha_challenge_request_outcome",
  ADD COLUMN "outcome_at" TIMESTAMPTZ(6),
  ADD COLUMN "delivery_error_code" TEXT;
