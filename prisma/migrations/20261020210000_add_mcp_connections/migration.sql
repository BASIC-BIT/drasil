CREATE TABLE "mcp_connections" (
  "id" UUID NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "user_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "selection_mode" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "mcp_connections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mcp_connections_version_positive" CHECK ("version" > 0),
  CONSTRAINT "mcp_connections_selection_mode_valid" CHECK ("selection_mode" IN ('selected', 'all_eligible')),
  CONSTRAINT "mcp_connections_scopes_valid" CHECK (
    "scopes" <@ ARRAY['drasil:read', 'drasil:moderate', 'drasil:configure']::TEXT[]
    AND array_position("scopes", NULL) IS NULL
  )
);

CREATE TABLE "mcp_connection_guilds" (
  "connection_id" UUID NOT NULL,
  "guild_id" TEXT NOT NULL,
  CONSTRAINT "mcp_connection_guilds_pkey" PRIMARY KEY ("connection_id", "guild_id"),
  CONSTRAINT "mcp_connection_guilds_connection_id_fkey" FOREIGN KEY ("connection_id")
    REFERENCES "mcp_connections"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_mcp_connections_user_client" ON "mcp_connections"("user_id", "client_id");
CREATE INDEX "idx_mcp_connection_guilds_guild" ON "mcp_connection_guilds"("guild_id");

ALTER TABLE "public"."mcp_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."mcp_connection_guilds" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "public"."mcp_connections", "public"."mcp_connection_guilds" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "public"."mcp_connections", "public"."mcp_connection_guilds" FROM authenticated;
  END IF;
END $$;
