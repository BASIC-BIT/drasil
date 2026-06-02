CREATE TYPE "report_intake_status" AS ENUM (
  'collecting_evidence',
  'needs_reporter_confirmation',
  'needs_admin_confirmation',
  'submitted',
  'closed_by_reporter',
  'actioned',
  'expired'
);

CREATE TYPE "report_intake_evidence_kind" AS ENUM (
  'reporter_text',
  'screenshot',
  'message_link',
  'reported_text',
  'followup_answer',
  'candidate_confirmation',
  'admin_note'
);

CREATE TABLE "report_intakes" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "server_id" text NOT NULL,
  "reporter_id" text NOT NULL,
  "thread_id" text,
  "status" "report_intake_status" NOT NULL DEFAULT 'collecting_evidence',
  "summary" text,
  "confirmed_target_user_id" text,
  "created_at" timestamptz(6) DEFAULT now(),
  "updated_at" timestamptz(6) DEFAULT now(),
  "closed_at" timestamptz(6),
  "metadata" jsonb DEFAULT '{}',
  CONSTRAINT "report_intakes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_intakes_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "servers"("guild_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "report_intakes_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("discord_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "report_intake_evidence" (
  "id" uuid NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "intake_id" uuid NOT NULL,
  "kind" "report_intake_evidence_kind" NOT NULL,
  "source_message_id" text,
  "source_channel_id" text,
  "attachment_id" text,
  "content" text,
  "metadata" jsonb DEFAULT '{}',
  "created_at" timestamptz(6) DEFAULT now(),
  CONSTRAINT "report_intake_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_intake_evidence_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "report_intakes"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "report_intakes_thread_id_key" ON "report_intakes"("thread_id");
CREATE INDEX "idx_report_intakes_server" ON "report_intakes"("server_id");
CREATE INDEX "idx_report_intakes_reporter" ON "report_intakes"("reporter_id");
CREATE INDEX "idx_report_intakes_status" ON "report_intakes"("status");
CREATE INDEX "idx_report_intake_evidence_intake" ON "report_intake_evidence"("intake_id");
CREATE INDEX "idx_report_intake_evidence_kind" ON "report_intake_evidence"("kind");
CREATE INDEX "idx_report_intake_evidence_message" ON "report_intake_evidence"("source_message_id");
