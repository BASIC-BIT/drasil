import type { Pool } from 'pg';
import { z } from 'zod';
import type { DelegatedPrincipal, DelegatedScope } from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { verifyBearerToken } from '@drasil/mcp-runtime/oauth2';
import { createWebDelegationDatabase } from '../adapters/database';
import { getPostgresPool } from '../../setupDataAdapter';
import { getMcpConfig, MCP_OAUTH_SCOPES, MCP_SCOPES, type McpConfig } from '../config';
import { resolveDiscordActor } from './flows';

export class McpAuthenticationError extends Error {
  constructor() {
    super('A current MCP connection authorization is required.');
  }
}
export function createBearerVerifier({
  pool,
  config,
}: {
  pool: Pool;
  config: McpConfig;
}): (request: Request) => Promise<{ principal: DelegatedPrincipal; expiresAt: number }> {
  const grants = createDelegationStore(createWebDelegationDatabase(pool));
  return async (request) => {
    try {
      const authorization = request.headers.get('authorization');
      // Bearer-only deployment: the maintained verifier also rejects JWT cnf bindings.
      if (!authorization?.match(/^Bearer [^\s]+$/i) || request.headers.has('dpop'))
        throw new McpAuthenticationError();
      const claims = await verifyBearerToken(authorization.slice(7), {
        verifyOptions: {
          issuer: config.issuer,
          audience: config.resource,
          requiredClaims: [
            'sub',
            'exp',
            'iat',
            'client_id',
            'scope',
            'delegation_grant_id',
            'delegation_grant_version',
          ],
        },
        jwksUrl: `${config.issuer}/jwks`,
      });
      // The library normalizes client_id from azp; require the signed values to agree.
      const signedClient = z
        .object({ client_id: z.string(), azp: z.string().optional() })
        .parse(
          JSON.parse(
            Buffer.from(authorization.slice(7).split('.')[1], 'base64url').toString('utf8')
          )
        );
      if (
        signedClient.client_id !== claims.client_id ||
        (signedClient.azp !== undefined && signedClient.azp !== signedClient.client_id) ||
        claims.cnf !== undefined
      )
        throw new McpAuthenticationError();
      if (
        claims.aud !== config.resource ||
        typeof claims.sub !== 'string' ||
        typeof claims.client_id !== 'string' ||
        typeof claims.scope !== 'string' ||
        typeof claims.delegation_grant_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(claims.delegation_grant_id) ||
        !Number.isSafeInteger(claims.delegation_grant_version) ||
        Number(claims.delegation_grant_version) < 1
      )
        throw new McpAuthenticationError();
      const scopes = claims.scope.split(' ').filter(Boolean);
      if (scopes.some((scope) => !MCP_OAUTH_SCOPES.includes(scope)))
        throw new McpAuthenticationError();
      const delegatedScopes = scopes.filter((scope): scope is DelegatedScope =>
        MCP_SCOPES.includes(scope as DelegatedScope)
      );
      if (!delegatedScopes.length) throw new McpAuthenticationError();
      const actor = await resolveDiscordActor(pool, claims.sub);
      const grant = await grants.findConnection(claims.delegation_grant_id);
      const client = (
        await pool.query<{ disabled: boolean | null }>(
          'select disabled from mcp_auth_oauth_client where "clientId"=$1',
          [claims.client_id]
        )
      ).rows[0];
      if (
        !client ||
        client.disabled ||
        !grant ||
        grant.revokedAt ||
        grant.userId !== actor ||
        grant.clientId !== claims.client_id ||
        grant.version !== claims.delegation_grant_version ||
        delegatedScopes.some((scope) => !grant.scopes.includes(scope))
      )
        throw new McpAuthenticationError();
      return {
        expiresAt: Number(claims.exp),
        principal: {
          userId: actor,
          clientId: grant.clientId,
          connectionId: grant.connectionId,
          grantVersion: grant.version,
          scopes: delegatedScopes,
        },
      };
    } catch {
      throw new McpAuthenticationError();
    }
  };
}
export async function verifyMcpPrincipal(request: Request): Promise<DelegatedPrincipal> {
  const config = getMcpConfig();
  if (!config) throw new McpAuthenticationError();
  return createPrincipalVerifier({ pool: getPostgresPool(), config })(request);
}

export function createPrincipalVerifier(deps: {
  pool: Pool;
  config: McpConfig;
}): (request: Request) => Promise<DelegatedPrincipal> {
  const verify = createBearerVerifier(deps);
  return async (request) => (await verify(request)).principal;
}
export async function verifyMcpBearer(
  request: Request
): Promise<{ principal: DelegatedPrincipal; expiresAt: number }> {
  const config = getMcpConfig();
  if (!config) throw new McpAuthenticationError();
  return createBearerVerifier({ pool: getPostgresPool(), config })(request);
}
