CREATE TABLE "mcp_intents" (
  "confirmation_id" TEXT PRIMARY KEY,
  "connection_id" UUID NOT NULL REFERENCES "mcp_connections"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "grant_version" INTEGER NOT NULL CHECK ("grant_version" > 0),
  "idempotency_key" TEXT NOT NULL CHECK (length("idempotency_key") BETWEEN 1 AND 128),
  "invocation_digest" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "resolved" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending','consumed','cancelled','expired','denied')),
  "confirmation_method" TEXT CHECK ("confirmation_method" IN ('elicitation','client_confirmation','website','discord','not_required')),
  CONSTRAINT "mcp_intents_expiry_limit" CHECK ("expires_at" <= "created_at" + INTERVAL '10 minutes'),
  CONSTRAINT "mcp_intents_connection_key" UNIQUE ("connection_id", "idempotency_key")
);
CREATE INDEX "mcp_intents_pending_expiry_idx" ON "mcp_intents"("state", "expires_at");
CREATE INDEX "mcp_intents_actor_pending_idx" ON "mcp_intents"("user_id", "state", "expires_at");

CREATE TABLE "mcp_executions" (
  "id" UUID PRIMARY KEY,
  "confirmation_id" TEXT NOT NULL UNIQUE REFERENCES "mcp_intents"("confirmation_id") ON DELETE CASCADE,
  "connection_id" UUID NOT NULL REFERENCES "mcp_connections"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "grant_version" INTEGER NOT NULL CHECK ("grant_version" > 0),
  "resolved" JSONB NOT NULL,
  "confirmation_method" TEXT NOT NULL CHECK ("confirmation_method" IN ('elicitation','client_confirmation','website','discord','not_required')),
  "queue_request_id" UUID UNIQUE REFERENCES "moderation_action_requests"("id") ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "outcome" JSONB
);
CREATE INDEX "mcp_executions_connection_idx" ON "mcp_executions"("connection_id");
ALTER TABLE "public"."mcp_intents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."mcp_executions" ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."mcp_intents", "public"."mcp_executions" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."mcp_intents", "public"."mcp_executions" FROM authenticated;
  END IF;
END $$;
