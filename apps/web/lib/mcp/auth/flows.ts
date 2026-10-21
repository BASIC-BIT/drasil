import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { DelegatedScope, GuildSelection } from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { verifyOAuthQueryParams } from '@drasil/mcp-runtime/oauth-provider';
import { createWebDelegationDatabase } from '../adapters/database';
import { MCP_OAUTH_SCOPES, MCP_SCOPES, type McpConfig } from '../config';

const FLOW_LIFETIME_MS = 10 * 60 * 1000;
const BINDING_PARAMS = [
  'drasil_flow',
  'client_id',
  'redirect_uri',
  'response_type',
  'code_challenge',
  'code_challenge_method',
  'scope',
  'resource',
  'state',
] as const;
export interface IssuerSession {
  user: { id: string };
  session: { id: string; userId: string };
}
export interface AuthorizationFlow {
  id: string;
  clientId: string;
  requestedScopes: string[];
  expiresAt: Date;
  referenceId: string | null;
  approvedScopes: string[] | null;
}
interface FlowRow {
  id: string;
  issuer_user_id: string;
  issuer_session_id: string;
  actor_discord_id: string;
  client_id: string;
  binding: Record<string, string>;
  requested_scopes: string[];
  expires_at: Date;
  cancelled_at: Date | null;
  reference_id: string | null;
  approved_scopes: string[] | null;
}
export interface AuthorizationReference {
  id: string;
  connection_id: string;
  frozen_grant_version: number;
  actor_discord_id: string;
  issuer_user_id: string;
  issuer_session_id: string;
  client_id: string;
  scopes: string[];
  resource: string;
  flow_id: string;
}
export class AuthorizationFlowError extends Error {
  constructor() {
    super('Invalid or expired MCP authorization flow.');
  }
}
function fail(): never {
  throw new AuthorizationFlowError();
}
function view(row: FlowRow): AuthorizationFlow {
  return {
    id: row.id,
    clientId: row.client_id,
    requestedScopes: row.requested_scopes,
    expiresAt: row.expires_at,
    referenceId: row.reference_id,
    approvedScopes: row.approved_scopes,
  };
}
export async function resolveDiscordActor(
  pool: Pool | PoolClient,
  issuerUserId: string
): Promise<string> {
  const result = await pool.query<{ accountId: string }>(
    'select "accountId" from mcp_auth_account where "userId"=$1 and "providerId"=\'discord\'',
    [issuerUserId]
  );
  if (result.rows.length !== 1 || !/^\d{17,20}$/.test(result.rows[0].accountId)) fail();
  return result.rows[0].accountId;
}
function binding(query: string): Record<string, string> {
  const params = new URLSearchParams(query);
  const result: Record<string, string> = {};
  for (const name of BINDING_PARAMS) {
    if (params.getAll(name).length > 1) fail();
    result[name] = params.get(name) ?? '';
  }
  return result;
}
function sameBinding(a: Record<string, string>, b: Record<string, string>): boolean {
  return BINDING_PARAMS.every((key) => a[key] === b[key]);
}
function validateSession(row: FlowRow, session: IssuerSession): void {
  if (
    session.user.id !== session.session.userId ||
    row.issuer_user_id !== session.user.id ||
    row.issuer_session_id !== session.session.id ||
    row.cancelled_at ||
    row.expires_at.getTime() <= Date.now()
  )
    fail();
}
export function createAuthorizationFlowService(pool: Pool, config: McpConfig) {
  async function verifiedBinding(query: string): Promise<Record<string, string>> {
    if (!(await verifyOAuthQueryParams(query, config.authSecret))) fail();
    const params = new URLSearchParams(query);
    const signed = new Set(params.getAll('ba_param'));
    const value = binding(query);
    // A valid signature over other parameters must not bless an unsigned nonce or authority input.
    for (const name of BINDING_PARAMS)
      if ((value[name] || name === 'drasil_flow') && !signed.has(name)) fail();
    if (
      !/^[0-9a-f-]{36}$/.test(value.drasil_flow) ||
      value.resource !== config.resource ||
      value.response_type !== 'code' ||
      value.code_challenge_method !== 'S256' ||
      !value.code_challenge ||
      !value.client_id ||
      !value.redirect_uri
    )
      fail();
    const scopes = value.scope.split(' ').filter(Boolean);
    if (
      !scopes.length ||
      scopes.some((scope) => !MCP_OAUTH_SCOPES.includes(scope)) ||
      !scopes.some((scope) => MCP_SCOPES.includes(scope as DelegatedScope))
    )
      fail();
    return value;
  }
  async function find(
    query: string,
    session: IssuerSession,
    client: Pool | PoolClient = pool,
    lock = false
  ): Promise<FlowRow> {
    const value = await verifiedBinding(query);
    const row = (
      await client.query<FlowRow>(
        `select * from mcp_authorization_flows where id=$1 ${lock ? 'for update' : ''}`,
        [value.drasil_flow]
      )
    ).rows[0];
    if (!row || !sameBinding(row.binding, value)) fail();
    validateSession(row, session);
    return row;
  }
  async function createAuthorizationFlow(
    session: IssuerSession,
    providerRequest: string
  ): Promise<AuthorizationFlow> {
    const value = await verifiedBinding(providerRequest);
    const currentSession = (
      await pool.query(
        'select id from mcp_auth_session where id=$1 and "userId"=$2 and "expiresAt">now()',
        [session.session.id, session.user.id]
      )
    ).rows[0];
    if (!currentSession || session.session.userId !== session.user.id) fail();
    const actor = await resolveDiscordActor(pool, session.user.id);
    await pool.query(
      `insert into mcp_authorization_flows (id,issuer_user_id,issuer_session_id,actor_discord_id,client_id,binding,requested_scopes,expires_at)
      values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8) on conflict (id) do nothing`,
      [
        value.drasil_flow,
        session.user.id,
        session.session.id,
        actor,
        value.client_id,
        JSON.stringify(value),
        value.scope.split(' ').filter(Boolean),
        new Date(Date.now() + FLOW_LIFETIME_MS),
      ]
    );
    return view(await find(providerRequest, session));
  }
  async function selectAuthorizationFlow(
    session: IssuerSession,
    providerRequest: string,
    selection: GuildSelection,
    approvedScopes?: readonly string[]
  ): Promise<{ id: string; referenceId: string; scopes: string[] }> {
    if (
      selection.mode !== 'all_eligible' &&
      (selection.mode !== 'selected' ||
        selection.guildIds.length === 0 ||
        selection.guildIds.length > 1000 ||
        selection.guildIds.some((id) => !/^\d{17,20}$/.test(id)))
    )
      fail();
    const client = await pool.connect();
    try {
      await client.query('begin');
      const flow = await find(providerRequest, session, client, true);
      if (flow.reference_id) fail();
      const scopes = [...new Set(approvedScopes ?? flow.requested_scopes)];
      if (
        !scopes.some((scope) => MCP_SCOPES.includes(scope as DelegatedScope)) ||
        scopes.some((scope) => !flow.requested_scopes.includes(scope))
      )
        fail();
      // Reuse canonical persistence inside this transaction: selection and reference commit together.
      const database = createWebDelegationDatabase(pool);
      const transactional = {
        query: database.query,
        transaction: async <T>(
          operation: Parameters<typeof database.transaction<T>>[0]
        ): Promise<T> =>
          operation({
            query: async (sql, values = []) => ({
              rows: (await client.query(sql, [...values])).rows,
            }),
          }),
      };
      const grant = await createDelegationStore(transactional).createConnection({
        userId: flow.actor_discord_id,
        clientId: flow.client_id,
        selection,
        scopes: scopes.filter((scope): scope is DelegatedScope =>
          MCP_SCOPES.includes(scope as DelegatedScope)
        ),
      });
      const referenceId = randomUUID();
      await client.query(
        `insert into mcp_authorization_references (id,connection_id,frozen_grant_version,actor_discord_id,issuer_user_id,issuer_session_id,client_id,scopes,resource,flow_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          referenceId,
          grant.connectionId,
          grant.version,
          flow.actor_discord_id,
          flow.issuer_user_id,
          flow.issuer_session_id,
          flow.client_id,
          scopes,
          config.resource,
          flow.id,
        ]
      );
      await client.query(
        'update mcp_authorization_flows set reference_id=$2,approved_scopes=$3 where id=$1',
        [flow.id, referenceId, scopes]
      );
      await client.query('commit');
      return { id: grant.connectionId, referenceId, scopes };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  async function cancelAuthorizationFlow(
    session: IssuerSession,
    providerRequest: string
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const flow = await find(providerRequest, session, client, true);
      await client.query('update mcp_authorization_flows set cancelled_at=now() where id=$1', [
        flow.id,
      ]);
      await client.query(
        `update mcp_connections set revoked_at=now(),version=version+1 where revoked_at is null and id in (select connection_id from mcp_authorization_references where flow_id=$1)`,
        [flow.id]
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  /** Provider-request-local continuation already passed the provider's signature verifier. */
  async function resolveProviderFlow(
    session: IssuerSession,
    query: string,
    scopes: readonly string[]
  ): Promise<FlowRow | null> {
    const value = binding(query);
    if (!/^[0-9a-f-]{36}$/.test(value.drasil_flow)) return null;
    const row = (
      await pool.query<FlowRow>('select * from mcp_authorization_flows where id=$1', [
        value.drasil_flow,
      ])
    ).rows[0];
    if (!row) return null;
    validateSession(row, session);
    const expectedScope = row.approved_scopes?.join(' ');
    // Consent may narrow scope before the provider runs authorization again.
    const expected =
      value.scope === expectedScope ? { ...row.binding, scope: expectedScope } : row.binding;
    if (
      !sameBinding(expected, value) ||
      scopes.some((scope) => !row.requested_scopes.includes(scope))
    )
      fail();
    return row;
  }
  return {
    createAuthorizationFlow,
    selectAuthorizationFlow,
    cancelAuthorizationFlow,
    resolveProviderFlow,
  };
}

/** Convenience entry point for server pages; session must come from the issuer's requireSession. */
export async function createAuthorizationFlow(
  session: IssuerSession,
  providerRequest: string
): Promise<AuthorizationFlow> {
  const { getMcpIssuer } = await import('./issuer');
  const issuer = getMcpIssuer();
  if (!issuer) throw new AuthorizationFlowError();
  return issuer.flows.createAuthorizationFlow(session, providerRequest);
}
