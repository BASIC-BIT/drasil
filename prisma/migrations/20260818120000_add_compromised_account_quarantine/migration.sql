CREATE TYPE "case_kind" AS ENUM ('standard', 'compromised_account');
CREATE TYPE "case_attention_state" AS ENUM ('review_required', 'parked');
CREATE TYPE "case_containment_status" AS ENUM ('not_applicable', 'in_progress', 'contained', 'incomplete');
CREATE TYPE "role_quarantine_snapshot_purpose" AS ENUM ('standard_case', 'compromised_account');

ALTER TYPE "admin_action_type" ADD VALUE 'quarantine_compromised_account';
ALTER TYPE "moderation_outcome_type" ADD VALUE 'account_quarantined';
ALTER TYPE "moderation_action_request_type" ADD VALUE 'quarantine_compromised_account';

ALTER TABLE "verification_events"
  ADD COLUMN "case_kind" "case_kind" NOT NULL DEFAULT 'standard',
  ADD COLUMN "attention_state" "case_attention_state" NOT NULL DEFAULT 'review_required',
  ADD COLUMN "containment_status" "case_containment_status" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN "parked_at" TIMESTAMPTZ(6),
  ADD COLUMN "parked_by" TEXT,
  ADD COLUMN "review_after" TIMESTAMPTZ(6);

ALTER TABLE "role_quarantine_snapshots"
  ADD COLUMN "purpose" "role_quarantine_snapshot_purpose" NOT NULL DEFAULT 'standard_case';

CREATE INDEX "idx_verification_events_server_status_attention"
  ON "verification_events"("server_id", "status", "attention_state");
