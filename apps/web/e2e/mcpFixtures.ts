import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../lib/mcp/adapters/database';

export const actorId = '123456789012345678';
export const guildA = '111111111111111111';
export const guildB = '222222222222222222';
export const guildFuture = '333333333333333333';
export const authSecret = 'task5-test-auth-secret-'.repeat(3);
const names: Record<string, string> = {
  [guildA]: 'Fixture North',
  [guildB]: 'Fixture South',
  [guildFuture]: 'Fixture Future',
};
export function mcpBrowserFixtures(origin: string) {
  let roleOnly = false;
  const effects: string[] = [];
  let pool: Pool;
  let store: ReturnType<typeof createDelegationStore>;
  let server: Server | undefined;
  async function start() {
    const connectionString = ownedTestDatabase();
    pool = new Pool({ connectionString });
    store = createDelegationStore(createWebDelegationDatabase(pool));
    await pool.query('TRUNCATE mcp_auth_jwks');
    server = createServer((request, response) => {
      if (request.method === 'DELETE' && request.url?.startsWith('/channels/')) {
        effects.push(request.url);
        response.writeHead(204);
        response.end();
        return;
      }
      const match = request.url?.match(/^\/guilds\/(\d+)(.*)$/);
      if (!match || !names[match[1]]) {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      const id = match[1];
      const suffix = match[2];
      const body =
        suffix === '/roles'
          ? [
              {
                id,
                name: '@everyone',
                permissions: roleOnly ? '0' : '8',
                position: 0,
                managed: false,
              },
              ...(roleOnly
                ? [
                    {
                      id: '444444444444444444',
                      name: 'Fixture responder',
                      permissions: '0',
                      position: 1,
                      managed: false,
                    },
                  ]
                : []),
            ]
          : suffix.startsWith('/members/')
            ? { user: { id: actorId }, roles: roleOnly ? ['444444444444444444'] : [] }
            : { id, owner_id: roleOnly ? '999999999999999999' : actorId, name: names[id] };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    });
    const listening = server;
    await new Promise<void>((resolve, reject) => {
      listening.once('error', reject);
      listening.listen(34567, '127.0.0.1', () => {
        listening.removeListener('error', reject);
        resolve();
      });
    });
  }
  async function reset(context: BrowserContext) {
    ownedTestDatabase();
    roleOnly = false;
    effects.length = 0;
    await pool.query(
      'truncate moderation_action_requests, moderation_queue_items, mcp_rate_buckets, mcp_metadata_permits, mcp_auth_user, mcp_auth_verification, mcp_auth_oauth_client, mcp_auth_rate_limit, mcp_authorization_flows, mcp_connections cascade'
    );
    await pool.query('delete from servers where guild_id=$1', [guildFuture]);
    for (const id of [guildA, guildB])
      await pool.query(
        'insert into servers(guild_id,settings,is_active) values($1,$2,true) on conflict(guild_id) do update set is_active=true, settings=EXCLUDED.settings',
        [id, '{}']
      );
    const userId = randomUUID();
    const sessionId = randomUUID();
    const token = randomBytes(32).toString('hex');
    // Test composition seeds a genuine maintained-provider session; production has no fixture path.
    await pool.query(
      'insert into mcp_auth_user(id,name,email,"emailVerified") values($1,$2,$3,false)',
      [userId, 'Fixture moderator', `${userId}@example.invalid`]
    );
    await pool.query(
      'insert into mcp_auth_account(id,"accountId","providerId","userId","updatedAt") values($1,$2,$3,$4,now())',
      [randomUUID(), actorId, 'discord', userId]
    );
    await pool.query(
      'insert into mcp_auth_session(id,"expiresAt",token,"updatedAt","userId") values($1,now()+interval \'1 hour\',$2,now(),$3)',
      [sessionId, token, userId]
    );
    const value = encodeURIComponent(
      `${token}.${createHmac('sha256', authSecret).update(token).digest('base64')}`
    );
    await context.addCookies([
      { name: 'drasil_mcp.session_token', value, url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
    const verified = await context.request.get('/api/mcp-auth/get-session');
    const verifiedSession = await verified.json();
    if (verifiedSession?.user?.id !== userId)
      throw new Error(
        'Seeded provider session was not accepted: ' + JSON.stringify(verifiedSession)
      );
    return { userId, sessionId };
  }
  async function client(request: APIRequestContext, label: string) {
    const response = await request.post('/api/mcp-auth/oauth2/register', {
      headers: { origin, 'x-forwarded-for': '127.0.0.1' },
      data: {
        client_name: label,
        redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'drasil:read drasil:moderate offline_access',
      },
    });
    if (!response.ok()) throw new Error(await response.text());
    return (await response.json()) as { client_id: string };
  }
  async function begin(request: APIRequestContext, clientId: string) {
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: 'https://client.example/callback',
      scope: 'drasil:read drasil:moderate offline_access',
      state: randomUUID(),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: `${origin}/api/mcp`,
    });
    const response = await request.get(`/api/mcp-auth/oauth2/authorize?${params}`, {
      headers: { accept: 'application/json' },
      maxRedirects: 0,
    });
    const body = await response.json();
    return { url: new URL(body.url, origin).href, verifier, clientId };
  }
  async function connection(clientId: string) {
    const row = await pool.query<{ id: string }>(
      'select id from mcp_connections where client_id=$1 order by created_at desc limit 1',
      [clientId]
    );
    if (!row.rows[0]) throw new Error('No connection');
    const grant = await store.findConnection(row.rows[0].id);
    if (!grant) throw new Error('No grant');
    return grant;
  }
  async function exchange(
    request: APIRequestContext,
    started: Awaited<ReturnType<typeof begin>>,
    code: string
  ) {
    const response = await request.post('/api/mcp-auth/oauth2/token', {
      headers: { origin, 'x-forwarded-for': '127.0.0.1' },
      form: {
        grant_type: 'authorization_code',
        client_id: started.clientId,
        redirect_uri: 'https://client.example/callback',
        code,
        code_verifier: started.verifier,
        resource: `${origin}/api/mcp`,
      },
    });
    if (!response.ok()) throw new Error(await response.text());
    return (await response.json()) as {
      access_token: string;
      refresh_token: string;
      scope: string;
    };
  }
  return {
    get pool() {
      return pool;
    },
    get store() {
      return store;
    },
    effects,
    async setRoleOnly() {
      roleOnly = true;
      await pool.query('update servers set settings=$1 where guild_id=ANY($2::text[])', [
        JSON.stringify({ case_responder_role_ids: ['444444444444444444'] }),
        [guildA, guildB],
      ]);
    },
    start,
    reset,
    client,
    begin,
    connection,
    exchange,
    async stop() {
      try {
        const listening = server;
        if (listening?.listening)
          await new Promise<void>((resolve, reject) =>
            listening.close((error) => (error ? reject(error) : resolve()))
          );
      } finally {
        await pool?.end();
      }
    },
  };
}
