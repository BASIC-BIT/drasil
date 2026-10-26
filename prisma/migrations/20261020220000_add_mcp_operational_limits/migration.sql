-- Application-owned rolling windows. Provider-owned rate rows keep their own lifecycle.
CREATE TABLE mcp_rate_buckets (
  subject text NOT NULL,
  category text NOT NULL,
  starts timestamptz[] NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (subject, category)
);
CREATE INDEX mcp_rate_buckets_expiry ON mcp_rate_buckets(expires_at);
-- Never expire a permit on a timer: a lost process is not proof of transport termination.
CREATE TABLE mcp_metadata_permits (
  id uuid PRIMARY KEY,
  origin text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.mcp_rate_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_metadata_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_rate_buckets,public.mcp_metadata_permits FROM PUBLIC;
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON TABLE public.mcp_rate_buckets,public.mcp_metadata_permits FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON TABLE public.mcp_rate_buckets,public.mcp_metadata_permits FROM authenticated;
 END IF;
END $$;
