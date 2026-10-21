import { createMcpLimits } from '../limits';
import { boundMetadataTransport } from '../metadata';
import { registrationIdentity } from '../ingress';
import { createProviderLogger } from '../audit';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { betterAuth, APIError } from '@drasil/mcp-runtime/auth';
import { jwt } from '@drasil/mcp-runtime/plugins';
import {
  oauthProvider,
  getOAuthProviderState,
  oauthProviderAuthServerMetadata,
  type OAuthClaimExtensionInput,
} from '@drasil/mcp-runtime/oauth-provider';
import { cimd } from '@drasil/mcp-runtime/cimd';
import { fetchClientMetadataResource } from '@drasil/mcp-runtime/cimd-node';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../adapters/database';
import { getPostgresPool } from '../../setupDataAdapter';
import { requireEnv } from '../../env';
import {
  getMcpConfig,
  MCP_ACCESS_TOKEN_SECONDS,
  MCP_REFRESH_TOKEN_SECONDS,
  MCP_OAUTH_SCOPES,
  type McpConfig,
} from '../config';
import {
  AuthorizationFlowError,
  createAuthorizationFlowService,
  resolveDiscordActor,
  type AuthorizationReference,
  type IssuerSession,
} from './flows';

export interface McpIssuerDependencies {
  pool: Pool;
  config: McpConfig;
  discord: { clientId: string; clientSecret: string };
}
function invalidGrant(): never {
  throw new APIError('BAD_REQUEST', {
    error: 'invalid_grant',
    error_description: 'The connection authorization is no longer valid.',
  });
}
export function createMcpIssuer({ pool, config, discord }: McpIssuerDependencies) {
  const flows = createAuthorizationFlowService(pool, config);
  const grants = createDelegationStore(createWebDelegationDatabase(pool));
  async function providerFlow(
    user: { id: string },
    session: { id: string; userId: string },
    scopes: readonly string[]
  ) {
    const state = await getOAuthProviderState();
    if (!state?.query) invalidGrant();
    try {
      return await flows.resolveProviderFlow({ user, session }, state.query, scopes);
    } catch (error) {
      if (error instanceof AuthorizationFlowError) invalidGrant();
      throw error;
    }
  }
  async function accessClaims(input: OAuthClaimExtensionInput): Promise<Record<string, unknown>> {
    if (!input.referenceId || !input.user) invalidGrant();
    const reference = (
      await pool.query<AuthorizationReference>(
        `select r.* from mcp_authorization_references r join mcp_authorization_flows f on f.id=r.flow_id where r.id=$1 and f.cancelled_at is null`,
        [input.referenceId]
      )
    ).rows[0];
    if (
      !reference ||
      input.user.id !== reference.issuer_user_id ||
      input.client.clientId !== reference.client_id ||
      (input.sessionId && input.sessionId !== reference.issuer_session_id) ||
      !input.resources ||
      input.resources.length !== 1 ||
      input.resources[0] !== reference.resource ||
      input.scopes.some((scope) => !reference.scopes.includes(scope))
    )
      invalidGrant();
    const actor = await resolveDiscordActor(pool, input.user.id).catch((error: unknown) => {
      if (error instanceof AuthorizationFlowError) invalidGrant();
      throw error;
    });
    const grant = await grants.findConnection(reference.connection_id);
    if (
      !grant ||
      grant.revokedAt ||
      grant.version !== reference.frozen_grant_version ||
      grant.userId !== actor ||
      actor !== reference.actor_discord_id ||
      grant.clientId !== reference.client_id ||
      input.scopes.some(
        (scope) =>
          scope !== 'offline_access' &&
          !grant.scopes.includes(scope as (typeof grant.scopes)[number])
      )
    )
      invalidGrant();
    return {
      delegation_grant_id: reference.connection_id,
      delegation_grant_version: reference.frozen_grant_version,
    };
  }
  const limits = createMcpLimits(createWebDelegationDatabase(pool));
  const auth = betterAuth({
    logger: createProviderLogger(),
    secrets: config.authSecrets ?? [{ version: 1, value: config.authSecret }],
    baseURL: config.origin,
    basePath: '/api/mcp-auth',
    secret: config.authSecret,
    database: pool,
    trustedOrigins: [config.origin],
    advanced: {
      cookiePrefix: 'drasil_mcp',
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: [] },
    },
    user: { modelName: 'mcp_auth_user' },
    session: { modelName: 'mcp_auth_session' },
    account: {
      modelName: 'mcp_auth_account',
      accountLinking: { enabled: false, disableImplicitLinking: true },
    },
    verification: { modelName: 'mcp_auth_verification' },
    emailAndPassword: { enabled: false },
    socialProviders: {
      discord: {
        ...discord,
        disableDefaultScope: true,
        scope: ['identify'],
        mapProfileToUser: (profile) => ({
          email: `${profile.id}@discord.placeholder.invalid`,
          emailVerified: false,
        }),
      },
    },
    disabledPaths: ['/token'],
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'mcp_auth_rate_limit',
      window: 60,
      max: 100,
    },
    plugins: [
      jwt({ schema: { jwks: { modelName: 'mcp_auth_jwks' } } }),
      oauthProvider({
        loginPage: '/mcp/connect',
        consentPage: '/mcp/consent',
        scopes: MCP_OAUTH_SCOPES,
        resources: [{ identifier: config.resource, allowedScopes: MCP_OAUTH_SCOPES }],
        clientRegistrationDefaultResources: [config.resource],
        clientRegistrationAllowedScopes: MCP_OAUTH_SCOPES,
        clientRegistrationDefaultScopes: ['drasil:read'],
        grantTypes: ['authorization_code', 'refresh_token'],
        accessTokenExpiresIn: MCP_ACCESS_TOKEN_SECONDS,
        refreshTokenExpiresIn: MCP_REFRESH_TOKEN_SECONDS,
        refreshTokenReuseInterval: 0,
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        rateLimit: { register: { window: 60, max: 5 } },
        schema: {
          oauthClient: { modelName: 'mcp_auth_oauth_client' },
          oauthResource: { modelName: 'mcp_auth_oauth_resource' },
          oauthClientResource: { modelName: 'mcp_auth_oauth_client_resource' },
          oauthRefreshToken: { modelName: 'mcp_auth_oauth_refresh_token' },
          oauthAccessToken: { modelName: 'mcp_auth_oauth_access_token' },
          oauthConsent: { modelName: 'mcp_auth_oauth_consent' },
          oauthClientAssertion: { modelName: 'mcp_auth_oauth_client_assertion' },
        },
        postLogin: {
          page: '/mcp/select-servers',
          shouldRedirect: async ({ user, session, scopes, isContinuation }) => {
            const flow = await providerFlow(user, session, scopes);
            if (isContinuation && !flow?.reference_id) invalidGrant();
            return !flow?.reference_id;
          },
          consentReferenceId: async ({ user, session, scopes }) => {
            const flow = await providerFlow(user, session, scopes);
            if (!flow?.reference_id) invalidGrant();
            return flow.reference_id;
          },
        },
        extensions: [{ claims: { accessToken: accessClaims } }],
      }),
      cimd({
        fetchClientMetadataResource: boundMetadataTransport(
          limits.acquireMetadata,
          fetchClientMetadataResource
        ),
        metadataProfile: 'mcp-2026-07-28',
        metadataFetchPolicy: {
          minimumFetchInterval: 1000,
          maximumConcurrentFetches: 16,
          maximumConcurrentFetchesPerOrigin: 4,
          maximumFetchesPerMinute: 120,
          maximumFetchesPerOriginPerMinute: 30,
        },
      }),
    ],
  });
  /** Only the maintained provider handles protocol state, signatures, codes and tokens. */
  async function handler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.slice('/api/mcp-auth'.length);
    // Reject alternate spellings before the provider router can normalize them around admission.
    if (path.includes('%') || path.includes('//') || path.endsWith('/'))
      return new Response(null, { status: 404 });
    // Client/resource management belongs to operators, not issuer browser sessions or DCR callers.
    if (
      path.startsWith('/admin/') ||
      /^\/oauth2\/(create-client|get-client|get-clients|update-client|delete-client|client\/|get-consent|get-consents|update-consent|delete-consent)/.test(
        path
      )
    )
      return new Response(null, { status: 404 });
    if (path === '/oauth2/register') {
      const identity = registrationIdentity(request, config.ipHashSecret);
      if (!identity) return Response.json({ error: 'registration_unavailable' }, { status: 503 });
      const budget = await limits.checkMcpLimit(
        { registrationIpHash: identity.hash },
        'registration'
      );
      if (budget.kind === 'limited')
        return Response.json(
          { error: 'rate_limited' },
          { status: 429, headers: { 'Retry-After': String(budget.retryAfterSeconds) } }
        );
      const headers = new Headers(request.headers);
      headers.set('x-forwarded-for', identity.ip);
      request = new Request(request, { headers });
    }
    if (path === '/oauth2/authorize') {
      if (request.method !== 'GET')
        return new Response(null, { status: 405, headers: { Allow: 'GET' } });
      if (
        url.searchParams.getAll('resource').length !== 1 ||
        url.searchParams.get('resource') !== config.resource
      )
        return Response.json({ error: 'invalid_target' }, { status: 400 });
      url.searchParams.set('drasil_flow', randomUUID());
      request = new Request(url, request);
    }
    return auth.handler(request);
  }
  async function requireSession(headers: Headers): Promise<IssuerSession> {
    const result = await auth.api.getSession({ headers });
    if (!result) throw new AuthorizationFlowError();
    return result;
  }
  /** Task 5 must call this at every browser mutation before the flow service. */
  async function requireBrowserSession(request: Request): Promise<IssuerSession> {
    if (
      request.method !== 'POST' ||
      request.headers.get('origin') !== config.origin ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new AuthorizationFlowError();
    return requireSession(request.headers);
  }
  return {
    auth,
    handler,
    discovery: oauthProviderAuthServerMetadata(auth),
    flows,
    requireSession,
    requireBrowserSession,
  };
}
export type McpIssuer = ReturnType<typeof createMcpIssuer>;
let singleton: McpIssuer | undefined;
export function getMcpIssuer(): McpIssuer | null {
  const config = getMcpConfig();
  if (!config) return null;
  return (singleton ??= createMcpIssuer({
    pool: getPostgresPool(),
    config,
    discord: {
      clientId: requireEnv('DISCORD_CLIENT_ID'),
      clientSecret: requireEnv('DISCORD_CLIENT_SECRET'),
    },
  }));
}
