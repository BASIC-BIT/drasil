ALTER TYPE moderation_action_request_type ADD VALUE 'ban_user';
ALTER TYPE moderation_action_request_type ADD VALUE 'kick_user';

-- This is the provider-send fence, distinct from execution admission/queue claim.
CREATE TABLE mcp_native_enforcements (
  execution_id uuid PRIMARY KEY REFERENCES mcp_executions(id) ON DELETE CASCADE,
  token uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  acknowledged_at timestamptz
);

ALTER TABLE public.mcp_native_enforcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_native_enforcements FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.mcp_native_enforcements FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.mcp_native_enforcements FROM authenticated;
  END IF;
END $$;
