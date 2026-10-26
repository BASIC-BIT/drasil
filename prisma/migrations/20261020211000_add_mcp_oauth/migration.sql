-- Generated with auth@1.7.12 generate; reviewed names, indexes, unique links and foreign keys.
create table "mcp_auth_user" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "mcp_auth_session" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" uuid not null references "mcp_auth_user" ("id") on delete cascade);

create table "mcp_auth_account" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "accountId" text not null, "providerId" text not null, "userId" uuid not null references "mcp_auth_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

create table "mcp_auth_verification" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

create table "mcp_auth_jwks" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz, "alg" text, "crv" text);

create table "mcp_auth_oauth_client" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" boolean, "skipConsent" boolean, "enableEndSession" boolean, "subjectType" text, "scopes" jsonb, "clientCredentialsScopes" jsonb, "userId" uuid references "mcp_auth_user" ("id") on delete cascade, "createdAt" timestamptz, "updatedAt" timestamptz, "name" text, "uri" text, "icon" text, "contacts" jsonb, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" jsonb not null, "postLogoutRedirectUris" jsonb, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" boolean, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" jsonb, "responseTypes" jsonb, "requirePKCE" boolean, "dpopBoundAccessTokens" boolean, "referenceId" text, "metadata" jsonb);

create table "mcp_auth_oauth_resource" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" jsonb, "customClaims" jsonb, "dpopBoundAccessTokensRequired" boolean, "disabled" boolean, "createdAt" timestamptz, "updatedAt" timestamptz, "policyVersion" integer, "metadata" jsonb);

create table "mcp_auth_oauth_client_resource" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "clientId" text not null references "mcp_auth_oauth_client" ("clientId") on delete cascade, "resourceId" text not null references "mcp_auth_oauth_resource" ("identifier") on delete cascade, "metadata" jsonb, "createdAt" timestamptz);

create table "mcp_auth_oauth_refresh_token" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "token" text not null unique, "clientId" text not null references "mcp_auth_oauth_client" ("clientId") on delete cascade, "sessionId" uuid references "mcp_auth_session" ("id") on delete set null, "userId" uuid not null references "mcp_auth_user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "rotatedAt" timestamptz, "rotationReplayResponse" text, "rotationReplayExpiresAt" timestamptz, "authTime" timestamptz, "confirmation" jsonb, "scopes" jsonb not null);

create table "mcp_auth_oauth_access_token" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "token" text not null unique, "clientId" text not null references "mcp_auth_oauth_client" ("clientId") on delete cascade, "sessionId" uuid references "mcp_auth_session" ("id") on delete set null, "userId" uuid references "mcp_auth_user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "refreshId" uuid references "mcp_auth_oauth_refresh_token" ("id") on delete cascade, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "confirmation" jsonb, "scopes" jsonb not null);

create table "mcp_auth_oauth_consent" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "clientId" text not null references "mcp_auth_oauth_client" ("clientId") on delete cascade, "userId" uuid references "mcp_auth_user" ("id") on delete cascade, "referenceId" text, "resources" jsonb, "requestedUserInfoClaims" jsonb, "scopes" jsonb not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "mcp_auth_oauth_client_assertion" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "expiresAt" timestamptz not null);

create table "mcp_auth_rate_limit" ("id" uuid default pg_catalog.gen_random_uuid() not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "mcp_auth_session_userId_idx" on "mcp_auth_session" ("userId");

create index "mcp_auth_account_userId_idx" on "mcp_auth_account" ("userId");

create index "mcp_auth_verification_identifier_idx" on "mcp_auth_verification" ("identifier");

create index "mcp_auth_oauth_client_userId_idx" on "mcp_auth_oauth_client" ("userId");

create index "mcp_auth_oauth_client_resource_clientId_idx" on "mcp_auth_oauth_client_resource" ("clientId");

create index "mcp_auth_oauth_client_resource_resourceId_idx" on "mcp_auth_oauth_client_resource" ("resourceId");

create index "mcp_auth_oauth_refresh_token_clientId_idx" on "mcp_auth_oauth_refresh_token" ("clientId");

create index "mcp_auth_oauth_refresh_token_sessionId_idx" on "mcp_auth_oauth_refresh_token" ("sessionId");

create index "mcp_auth_oauth_refresh_token_userId_idx" on "mcp_auth_oauth_refresh_token" ("userId");

create index "mcp_auth_oauth_refresh_token_authorizationCodeId_idx" on "mcp_auth_oauth_refresh_token" ("authorizationCodeId");

create index "mcp_auth_oauth_access_token_clientId_idx" on "mcp_auth_oauth_access_token" ("clientId");

create index "mcp_auth_oauth_access_token_sessionId_idx" on "mcp_auth_oauth_access_token" ("sessionId");

create index "mcp_auth_oauth_access_token_userId_idx" on "mcp_auth_oauth_access_token" ("userId");

create index "mcp_auth_oauth_access_token_authorizationCodeId_idx" on "mcp_auth_oauth_access_token" ("authorizationCodeId");

create index "mcp_auth_oauth_access_token_refreshId_idx" on "mcp_auth_oauth_access_token" ("refreshId");

create index "mcp_auth_oauth_consent_clientId_idx" on "mcp_auth_oauth_consent" ("clientId");

create index "mcp_auth_oauth_consent_userId_idx" on "mcp_auth_oauth_consent" ("userId");

create unique index "mcp_auth_oauth_client_resource_clientId_resourceId_uidx" on "mcp_auth_oauth_client_resource" ("clientId", "resourceId");


CREATE TABLE mcp_authorization_flows (
  id UUID PRIMARY KEY,
  issuer_user_id UUID NOT NULL REFERENCES mcp_auth_user(id) ON DELETE CASCADE,
  -- Historical binding: offline grants must survive issuer logout/session cleanup.
  issuer_session_id UUID NOT NULL,
  actor_discord_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES mcp_auth_oauth_client("clientId") ON DELETE CASCADE,
  binding JSONB NOT NULL,
  requested_scopes TEXT[] NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  cancelled_at TIMESTAMPTZ,
  reference_id UUID UNIQUE,
  approved_scopes TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcp_authorization_flows_session_idx ON mcp_authorization_flows(issuer_session_id);
CREATE INDEX mcp_authorization_flows_expiry_idx ON mcp_authorization_flows(expires_at);
CREATE TABLE mcp_authorization_references (
  id UUID PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES mcp_connections(id) ON DELETE CASCADE,
  frozen_grant_version INTEGER NOT NULL CHECK (frozen_grant_version > 0),
  actor_discord_id TEXT NOT NULL,
  issuer_user_id UUID NOT NULL REFERENCES mcp_auth_user(id) ON DELETE CASCADE,
  issuer_session_id UUID NOT NULL,
  client_id TEXT NOT NULL REFERENCES mcp_auth_oauth_client("clientId") ON DELETE CASCADE,
  scopes TEXT[] NOT NULL,
  resource TEXT NOT NULL,
  flow_id UUID NOT NULL UNIQUE REFERENCES mcp_authorization_flows(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mcp_authorization_references_connection_idx ON mcp_authorization_references(connection_id);
-- References remain frozen even after connection edits or session expiry.
CREATE FUNCTION mcp_reject_authorization_reference_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'MCP authorization references are immutable'; END;
$$;
CREATE TRIGGER mcp_authorization_reference_immutable BEFORE UPDATE ON mcp_authorization_references
FOR EACH ROW EXECUTE FUNCTION mcp_reject_authorization_reference_update();

ALTER TABLE public."mcp_auth_user" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_user" FROM PUBLIC;

ALTER TABLE public."mcp_auth_session" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_session" FROM PUBLIC;

ALTER TABLE public."mcp_auth_account" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_account" FROM PUBLIC;

ALTER TABLE public."mcp_auth_verification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_verification" FROM PUBLIC;

ALTER TABLE public."mcp_auth_jwks" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_jwks" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_client" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_client" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_resource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_resource" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_client_resource" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_client_resource" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_refresh_token" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_refresh_token" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_access_token" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_access_token" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_consent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_consent" FROM PUBLIC;

ALTER TABLE public."mcp_auth_oauth_client_assertion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_oauth_client_assertion" FROM PUBLIC;

ALTER TABLE public."mcp_auth_rate_limit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_auth_rate_limit" FROM PUBLIC;

ALTER TABLE public."mcp_authorization_flows" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_authorization_flows" FROM PUBLIC;

ALTER TABLE public."mcp_authorization_references" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."mcp_authorization_references" FROM PUBLIC;

DO $$
DECLARE private_table text;
BEGIN
  FOREACH private_table IN ARRAY ARRAY['mcp_auth_user','mcp_auth_session','mcp_auth_account','mcp_auth_verification','mcp_auth_jwks','mcp_auth_oauth_client','mcp_auth_oauth_resource','mcp_auth_oauth_client_resource','mcp_auth_oauth_refresh_token','mcp_auth_oauth_access_token','mcp_auth_oauth_consent','mcp_auth_oauth_client_assertion','mcp_auth_rate_limit','mcp_authorization_flows','mcp_authorization_references'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', private_table);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', private_table);
    END IF;
  END LOOP;
END $$;
