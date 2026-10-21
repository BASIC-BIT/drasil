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
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const store = createDelegationStore(createWebDelegationDatabase(pool));
  let server: Server;
  async function start() {
    if (!process.env.TEST_DATABASE_URL) throw new Error('Source the owned MCP test.env first.');
    const url = new URL(process.env.TEST_DATABASE_URL);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55433' ||
      url.pathname !== '/drasil_mcp_test'
    )
      throw new Error('Only the owned localhost MCP test database is allowed.');

    server = createServer((request, response) => {
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
          ? [{ id, name: '@everyone', permissions: '8', position: 0, managed: false }]
          : suffix.startsWith('/members/')
            ? { user: { id: actorId }, roles: [] }
            : { id, owner_id: actorId, name: names[id] };
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => server.listen(34567, '127.0.0.1', resolve));
  }
  async function reset(context: BrowserContext) {
    await pool.query(
      'truncate mcp_auth_jwks, mcp_auth_user, mcp_auth_verification, mcp_auth_oauth_client, mcp_auth_rate_limit, mcp_authorization_flows, mcp_connections cascade'
    );
    await pool.query('delete from servers where guild_id=$1', [guildFuture]);
    for (const id of [guildA, guildB])
      await pool.query(
        'insert into servers(guild_id,settings,is_active) values($1,$2,true) on conflict(guild_id) do update set is_active=true',
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
      headers: { origin },
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
      headers: { origin },
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
    pool,
    store,
    start,
    reset,
    client,
    begin,
    connection,
    exchange,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    },
  };
}
