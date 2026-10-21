import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import dns from 'node:dns/promises';
import https from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { createMcpIssuer } from './issuer';
import { createPrincipalVerifier, createBearerVerifier } from './principal';
import { fetchClientMetadataResource } from '@drasil/mcp-runtime/cimd-node';

const origin = 'http://localhost:3456';
const issuer = `${origin}/api/mcp-auth`;
const resource = `${origin}/api/mcp`;
const discordId = '123456789012345678';
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const auth = createMcpIssuer({
  pool,
  config: {
    origin,
    issuer,
    resource,
    authSecret: 'integration-only-secret-'.repeat(3),
    cursorSecret: 'integration-cursor-'.repeat(3),
  },
  discord: { clientId: 'controlled-client', clientSecret: 'controlled-secret' },
});
const verify = createPrincipalVerifier({
  pool,
  config: { origin, issuer, resource, authSecret: 'unused', cursorSecret: 'unused' },
});
let cookie = '';
let session: { user: { id: string }; session: { id: string; userId: string } };
interface Client {
  client_id: string;
  redirect_uris: string[];
}
interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}
const originalFetch = globalThis.fetch;
beforeAll(async () => {
  // Other disposable issuer fixtures use different encryption secrets.
  await pool.query('TRUNCATE mcp_auth_jwks');
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://discord.com/api/oauth2/token')
      return Response.json({
        access_token: 'controlled-discord-access',
        refresh_token: 'controlled-discord-refresh',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'identify',
      });
    if (decodeURIComponent(url) === 'https://discord.com/api/users/@me')
      return Response.json({
        id: discordId,
        username: 'phone-only',
        global_name: 'Phone only',
        avatar: null,
        discriminator: '0',
        email: null,
        verified: false,
      });
    if (url.startsWith(issuer)) return auth.handler(new Request(input, init));
    return originalFetch(input, init);
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await pool.end();
});
async function call(
  path: string,
  body?: Record<string, string | boolean | string[]>,
  options: { anonymous?: boolean; form?: boolean; status?: number } = {}
) {
  const headers = new Headers({ accept: 'application/json', 'x-forwarded-for': '127.0.0.1' });
  if (!options.anonymous && cookie) headers.set('cookie', cookie);
  if (body) {
    headers.set(
      'content-type',
      options.form ? 'application/x-www-form-urlencoded' : 'application/json'
    );
    if (!options.form) headers.set('origin', origin);
  }
  const response = await auth.handler(
    new Request(issuer + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body
        ? options.form
          ? new URLSearchParams(body as Record<string, string>).toString()
          : JSON.stringify(body)
        : undefined,
    })
  );
  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  if (options.status !== undefined)
    expect(response.status, JSON.stringify(json)).toBe(options.status);
  else expect(response.status, JSON.stringify(json)).toBeLessThan(400);
  return { response, json };
}
beforeEach(async () => {
  await pool.query(
    'TRUNCATE mcp_auth_user, mcp_auth_verification, mcp_auth_oauth_client, mcp_auth_rate_limit, mcp_authorization_flows, mcp_connections CASCADE'
  );
  cookie = '';
  const login = await call('/sign-in/social', {
    provider: 'discord',
    callbackURL: origin + '/mcp/connect',
  });
  expect(new URL(login.json.url).searchParams.get('scope')).toBe('identify');
  cookie = login.response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const callback = await call(
    '/callback/discord?' +
      new URLSearchParams({
        code: 'controlled-code',
        state: new URL(login.json.url).searchParams.get('state')!,
      })
  );
  cookie = callback.response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  session = (await call('/get-session')).json;
});
async function client(name = 'client'): Promise<Client> {
  return (
    await call(
      '/oauth2/register',
      {
        client_name: name,
        redirect_uris: ['https://client.example/callback'],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'drasil:read drasil:moderate offline_access',
      },
      { anonymous: true }
    )
  ).json;
}
async function start(c: Client, scopes = 'drasil:read offline_access') {
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: c.client_id,
    redirect_uri: c.redirect_uris[0],
    scope: scopes,
    state: randomBytes(24).toString('hex'),
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    resource,
    drasil_flow: 'client-controlled',
  });
  const redirect = (await call('/oauth2/authorize?' + query)).json.url;
  const signedQuery = new URL(redirect, origin).search.slice(1);
  expect(new URL(redirect, origin).pathname).toBe('/mcp/select-servers');
  expect(new URLSearchParams(signedQuery).get('drasil_flow')).not.toBe('client-controlled');
  const flow = await auth.flows.createAuthorizationFlow(session, signedQuery);
  return { client: c, verifier, signedQuery, flow };
}
type Started = Awaited<ReturnType<typeof start>>;
async function select(item: Started, guildId: string, scopes?: string[]) {
  return auth.flows.selectAuthorizationFlow(
    session,
    item.signedQuery,
    { mode: 'selected', guildIds: [guildId] },
    scopes
  );
}
async function consent(item: Started, scopes?: string[]) {
  const continued = (
    await call('/oauth2/continue', { postLogin: true, oauth_query: item.signedQuery })
  ).json.url;
  expect(new URL(continued, origin).pathname).toBe('/mcp/consent');
  const consentQuery = new URL(continued, origin).search.slice(1);
  const accepted = (
    await call('/oauth2/consent', {
      accept: true,
      oauth_query: consentQuery,
      ...(scopes ? { scope: scopes.join(' ') } : {}),
    })
  ).json.url;
  return new URL(accepted).searchParams.get('code')!;
}
async function exchange(
  item: Started,
  code: string,
  overrides: Record<string, string> = {},
  status?: number
): Promise<Tokens> {
  return (
    await call(
      '/oauth2/token',
      {
        grant_type: 'authorization_code',
        client_id: item.client.client_id,
        redirect_uri: item.client.redirect_uris[0],
        code,
        code_verifier: item.verifier,
        resource,
        ...overrides,
      },
      { anonymous: true, form: true, status }
    )
  ).json;
}
async function refresh(item: Started, tokens: Tokens, status?: number): Promise<Tokens> {
  return (
    await call(
      '/oauth2/token',
      {
        grant_type: 'refresh_token',
        client_id: item.client.client_id,
        refresh_token: tokens.refresh_token,
        resource,
      },
      { anonymous: true, form: true, status }
    )
  ).json;
}
function payload(tokens: Tokens): Record<string, unknown> {
  return JSON.parse(Buffer.from(tokens.access_token.split('.')[1], 'base64url').toString());
}
function admission(tokens: Tokens) {
  return verify(
    new Request(resource, { headers: { authorization: `Bearer ${tokens.access_token}` } })
  );
}
it('isolates concurrent OAuth grant references', async () => {
  const [clientA, clientB] = [await client('A'), await client('B')];
  const [a, b] = await Promise.all([start(clientA), start(clientB)]);
  const grantB = await select(b, '222222222222222222');
  const grantA = await select(a, '111111111111111111');
  const [codeA, codeB] = await Promise.all([consent(a), consent(b)]);
  const tokensB = await exchange(b, codeB);
  const tokensA = await exchange(a, codeA);
  const tokenA = payload(tokensA);
  const tokenB = payload(tokensB);
  expect(tokenA.delegation_grant_id).toBe(grantA.id);
  expect(tokenB.delegation_grant_id).toBe(grantB.id);
  expect(payload(await refresh(b, tokensB)).delegation_grant_id).toBe(grantB.id);
  expect(payload(await refresh(a, tokensA)).delegation_grant_id).toBe(grantA.id);
  expect(await admission(tokensA)).toMatchObject({
    userId: discordId,
    connectionId: grantA.id,
    clientId: clientA.client_id,
    grantVersion: 1,
  });
});
it('isolates two connections for the same client and freezes reduced consent scopes', async () => {
  const c = await client();
  const a = await start(c, 'drasil:read drasil:moderate offline_access');
  const b = await start(c);
  const grantA = await select(a, '111111111111111111', ['drasil:read', 'offline_access']);
  const grantB = await select(b, '222222222222222222');
  const tokenB = await exchange(b, await consent(b));
  const tokenA = await exchange(a, await consent(a, ['drasil:read', 'offline_access']));
  expect(payload(await refresh(a, tokenA))).toMatchObject({
    delegation_grant_id: grantA.id,
    scope: 'drasil:read offline_access',
  });
  expect(payload(await refresh(b, tokenB)).delegation_grant_id).toBe(grantB.id);
});
it('uses the verified Discord account relation and separate cookies for phone-only users', async () => {
  expect(session.user.id).not.toBe(discordId);
  const row = (
    await pool.query('select * from mcp_auth_account where "userId"=$1', [session.user.id])
  ).rows[0];
  expect(row).toMatchObject({ accountId: discordId, providerId: 'discord' });
  expect((await call('/get-session')).json.user.email).toBe(
    `${discordId}@discord.placeholder.invalid`
  );
  expect(cookie).toContain('drasil_mcp');
});
it('publishes discovery and enforces access and refresh lifetimes', async () => {
  const discovery = await auth.discovery(
    new Request(origin + '/.well-known/oauth-authorization-server/api/mcp-auth')
  );
  expect(await discovery.json()).toMatchObject({
    issuer,
    grant_types_supported: ['authorization_code', 'refresh_token'],
  });
  const a = await start(await client());
  await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  expect(tokens.expires_in).toBe(900);
  const claims = payload(tokens);
  expect(Number(claims.exp) - Number(claims.iat)).toBe(900);
  const rows = (await pool.query('select * from mcp_auth_oauth_refresh_token')).rows;
  expect(rows).toHaveLength(1);
  expect((rows[0].expiresAt - rows[0].createdAt) / 1000).toBe(2592000);
  expect(JSON.stringify(tokens)).not.toContain('controlled-discord');
});
it.each(['sign-out', 'expired-session cleanup'])(
  'preserves the frozen offline authorization after %s',
  async (ending) => {
    const a = await start(await client(), 'drasil:read drasil:moderate offline_access');
    const approvedScopes = ['drasil:read', 'offline_access'];
    const grant = await select(a, '111111111111111111', approvedScopes);
    const tokens = await exchange(a, await consent(a, approvedScopes));
    const reference = (
      await pool.query('select * from mcp_authorization_references where id=$1', [
        grant.referenceId,
      ])
    ).rows[0];
    const flow = (
      await pool.query('select * from mcp_authorization_flows where id=$1', [a.flow.id])
    ).rows[0];
    if (ending === 'sign-out') {
      await call('/sign-out', {});
    } else {
      await pool.query(
        `update mcp_auth_session set "expiresAt"=now()-interval '1 second' where id=$1`,
        [session.session.id]
      );
      expect((await call('/get-session')).json).toBeNull();
    }
    expect(
      (await pool.query('select id from mcp_auth_session where id=$1', [session.session.id])).rows
    ).toEqual([]);

    const rotated = await refresh(a, tokens);
    expect(payload(rotated)).toMatchObject({
      delegation_grant_id: grant.id,
      delegation_grant_version: 1,
      scope: approvedScopes.join(' '),
    });
    expect(await admission(rotated)).toMatchObject({
      userId: discordId,
      clientId: a.client.client_id,
      connectionId: grant.id,
      grantVersion: 1,
      scopes: ['drasil:read'],
    });
    expect((await pool.query('select * from mcp_authorization_references')).rows).toEqual([
      reference,
    ]);
    expect((await pool.query('select * from mcp_authorization_flows')).rows).toEqual([flow]);
    expect(reference).toMatchObject({
      issuer_session_id: session.session.id,
      connection_id: grant.id,
      frozen_grant_version: 1,
      scopes: approvedScopes,
    });
    const refreshRows = (await pool.query('select * from mcp_auth_oauth_refresh_token')).rows;
    expect(refreshRows).toHaveLength(2);
    for (const row of refreshRows) {
      expect(row).toMatchObject({
        referenceId: grant.referenceId,
        sessionId: null,
        scopes: approvedScopes,
      });
    }

    await pool.query('update mcp_connections set revoked_at=now(),version=version+1 where id=$1', [
      grant.id,
    ]);
    expect(await refresh(a, rotated, 400)).toMatchObject({ error: 'invalid_grant' });
    await expect(admission(rotated)).rejects.toThrow();
  }
);
it.each(['user', 'client', 'connection'])(
  'still rejects offline refresh after deleting its %s',
  async (owner) => {
    const a = await start(await client());
    const grant = await select(a, '111111111111111111');
    const tokens = await exchange(a, await consent(a));
    await call('/sign-out', {});
    const rotated = await refresh(a, tokens);
    if (owner === 'user') {
      await pool.query('delete from mcp_auth_user where id=$1', [session.user.id]);
    } else if (owner === 'client') {
      await pool.query('delete from mcp_auth_oauth_client where "clientId"=$1', [
        a.client.client_id,
      ]);
    } else {
      await pool.query('delete from mcp_connections where id=$1', [grant.id]);
    }
    expect((await pool.query('select id from mcp_authorization_references')).rows).toEqual([]);
    await refresh(a, rotated, 400);
    await expect(admission(rotated)).rejects.toThrow();
  }
);
it('rejects an actually expired refresh token', async () => {
  const a = await start(await client());
  const grant = await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  await pool.query(
    `update mcp_auth_oauth_refresh_token set "expiresAt"=now()-interval '1 second' where "referenceId"=$1`,
    [grant.referenceId]
  );
  expect(await refresh(a, tokens, 400)).toMatchObject({ error: 'invalid_grant' });
});
it.each(['deleted', 'expired'])(
  'rejects pending browser operations when the issuer session is %s',
  async (ending) => {
    const c = await client();
    const pending = await start(c);
    const selected = await start(c);
    const grant = await select(selected, '111111111111111111');
    if (ending === 'deleted') {
      await call('/sign-out', {});
    } else {
      await pool.query(
        `update mcp_auth_session set "expiresAt"=now()-interval '1 second' where id=$1`,
        [session.session.id]
      );
    }
    // A previously authenticated session object cannot authorize later browser work.
    await expect(
      auth.flows.createAuthorizationFlow(session, pending.signedQuery)
    ).rejects.toThrow();
    await expect(select(pending, '222222222222222222')).rejects.toThrow();
    await expect(
      auth.flows.cancelAuthorizationFlow(session, selected.signedQuery)
    ).rejects.toThrow();
    await expect(
      auth.flows.resolveProviderFlow(session, selected.signedQuery, grant.scopes)
    ).rejects.toThrow();
    expect((await pool.query('select id,revoked_at,version from mcp_connections')).rows).toEqual([
      { id: grant.id, revoked_at: null, version: 1 },
    ]);
  }
);
it('rejects stale versions and revoked grants at refresh and MCP admission', async () => {
  for (const change of ['version=version+1', 'revoked_at=now()']) {
    const a = await start(await client());
    const grant = await select(a, '111111111111111111');
    const tokens = await exchange(a, await consent(a));
    await pool.query(`update mcp_connections set ${change} where id=$1`, [grant.id]);
    await refresh(a, tokens, 400);
    await expect(admission(tokens)).rejects.toThrow();
  }
});
it('rotates refresh tokens and rejects replay', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  const rotated = await refresh(a, tokens);
  expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
  await refresh(a, tokens, 400);
  await refresh(a, rotated, 400);
});
it.each<Record<string, string>>([
  { code_verifier: 'wrong' },
  { redirect_uri: 'https://wrong.example/' },
  { resource: 'https://wrong.example/api/mcp' },
])('rejects invalid token exchange %j', async (overrides) => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  await exchange(a, await consent(a), overrides, 400);
});
it('rejects unsigned, tampered, expired and foreign-session flow selections', async () => {
  const a = await start(await client());
  await expect(
    auth.flows.createAuthorizationFlow(
      session,
      a.signedQuery.replace('client_id=', 'client_id=wrong')
    )
  ).rejects.toThrow();
  await expect(
    auth.flows.createAuthorizationFlow(session, 'drasil_flow=unsigned')
  ).rejects.toThrow();
  await expect(
    auth.flows.createAuthorizationFlow(
      { ...session, session: { ...session.session, id: 'other' } },
      a.signedQuery
    )
  ).rejects.toThrow();
  await pool.query(
    "update mcp_authorization_flows set expires_at=now()-interval '1 second' where id=$1",
    [a.flow.id]
  );
  await expect(select(a, '111111111111111111')).rejects.toThrow();
});
it('makes selection immutable, and cancellation prevents continuation', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  await expect(select(a, '222222222222222222')).rejects.toThrow();
  await auth.flows.cancelAuthorizationFlow(session, a.signedQuery);
  await call('/oauth2/continue', { postLogin: true, oauth_query: a.signedQuery }, { status: 400 });
});
it('rate limits public dynamic registration', async () => {
  for (let i = 0; i < 5; i++) await client(`client-${i}`);
  await call(
    '/oauth2/register',
    {
      client_name: 'rate-limited',
      redirect_uris: ['https://client.example/callback'],
      token_endpoint_auth_method: 'none',
    },
    { anonymous: true, status: 429 }
  );
});
it('rejects non-public CIMD addresses through the maintained Node transport', async () => {
  for (const url of [
    'http://client.example/metadata',
    'https://127.0.0.1/metadata',
    'https://localhost/metadata',
  ]) {
    await expect(fetchClientMetadataResource(url, { headers: {} })).rejects.toThrow();
  }
});

it('never expands approved scopes from authorization-code token input', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a), { scope: 'drasil:configure' });
  expect(payload(tokens).scope).toBe('drasil:read offline_access');
  await call(
    '/oauth2/token',
    {
      grant_type: 'refresh_token',
      client_id: a.client.client_id,
      refresh_token: tokens.refresh_token,
      resource,
      scope: 'drasil:configure',
    },
    { anonymous: true, form: true, status: 400 }
  );
});

it('rejects invalid signed claims and never falls back to another grant', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  const claims = payload(tokens);
  const changes: Record<string, unknown>[] = [
    { iss: 'https://other.example' },
    { aud: 'https://other.example/api/mcp' },
    { exp: Math.floor(Date.now() / 1000) - 60 },
    { delegation_grant_id: undefined },
    { delegation_grant_version: '1' },
    { delegation_grant_version: 2 },
    { delegation_grant_id: '00000000-0000-4000-8000-000000000000' },
    { sub: discordId },
    { client_id: 'other' },
    { scope: 'drasil:configure' },
    { scope: 'unknown' },
    { cnf: { jkt: 'bound-token' } },
  ];
  for (const change of changes) {
    const signed = await auth.auth.api.signJWT({ body: { payload: { ...claims, ...change } } });
    await expect(
      admission({ ...tokens, access_token: signed.token }),
      JSON.stringify(change)
    ).rejects.toThrow();
  }
  const corrupted = tokens.access_token.slice(0, -8) + 'tampered';
  await expect(admission({ ...tokens, access_token: corrupted })).rejects.toThrow();
  await expect(
    verify(new Request(resource, { headers: { authorization: `DPoP ${tokens.access_token}` } }))
  ).rejects.toThrow();
  await pool.query('update mcp_auth_oauth_client set disabled=true where "clientId"=$1', [
    a.client.client_id,
  ]);
  await expect(admission(tokens)).rejects.toThrow();
});
it('enforces S256, approved redirect, resource and scopes at authorization', async () => {
  const c = await client();
  const base = {
    response_type: 'code',
    client_id: c.client_id,
    redirect_uri: c.redirect_uris[0],
    scope: 'drasil:read',
    resource,
    code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256',
  };
  for (const change of [
    { code_challenge_method: 'plain' },
    { code_challenge: '' },
    { redirect_uri: 'https://evil.example/callback' },
    { scope: 'unknown' },
    { resource: 'https://other.example/api/mcp' },
  ]) {
    const response = await auth.handler(
      new Request(issuer + '/oauth2/authorize?' + new URLSearchParams({ ...base, ...change }), {
        headers: { accept: 'application/json', cookie },
      })
    );
    const value = await response.json();
    expect(
      response.status >= 400 ||
        Boolean(value.error) ||
        Boolean(value.url && new URL(value.url, origin).searchParams.get('error')),
      JSON.stringify({ change, value, status: response.status })
    ).toBe(true);
  }
});
it('rejects authorization code replay and cross-client exchange', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  const code = await consent(a);
  await exchange(a, code);
  await exchange(a, code, {}, 400);
  const b = await start(await client());
  await select(b, '222222222222222222');
  const codeB = await consent(b);
  await exchange(b, codeB, { client_id: a.client.client_id }, 400);
});
it('cancels only the selected flow and revokes an already minted token', async () => {
  const c = await client();
  const a = await start(c);
  const b = await start(c);
  await select(a, '111111111111111111');
  await select(b, '222222222222222222');
  const tokenA = await exchange(a, await consent(a));
  const tokenB = await exchange(b, await consent(b));
  await auth.flows.cancelAuthorizationFlow(session, a.signedQuery);
  await expect(admission(tokenA)).rejects.toThrow();
  await refresh(a, tokenA, 400);
  expect((await admission(await refresh(b, tokenB))).clientId).toBe(c.client_id);
});
it('rejects browser mutations without the exact origin and issuer session', async () => {
  await expect(
    auth.requireBrowserSession(
      new Request(origin + '/mcp/select-servers', { method: 'POST', headers: { cookie } })
    )
  ).rejects.toThrow();
  await expect(
    auth.requireBrowserSession(
      new Request(origin + '/mcp/select-servers', {
        method: 'POST',
        headers: { cookie, origin: 'https://evil.example' },
      })
    )
  ).rejects.toThrow();
  await expect(
    auth.requireBrowserSession(
      new Request(origin + '/mcp/select-servers', { method: 'POST', headers: { origin } })
    )
  ).rejects.toThrow();
  expect(
    await auth.requireBrowserSession(
      new Request(origin + '/mcp/select-servers', { method: 'POST', headers: { cookie, origin } })
    )
  ).toMatchObject({ user: { id: session.user.id }, session: { id: session.session.id } });
});
it('keeps immutable references and every issuer table private', async () => {
  const a = await start(await client());
  const selected = await select(a, '111111111111111111');
  await expect(
    pool.query('update mcp_authorization_references set frozen_grant_version=2 where id=$1', [
      selected.referenceId,
    ])
  ).rejects.toThrow('immutable');
  const tables = (
    await pool.query(
      "select relname,relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='r' and (relname like 'mcp_auth_%' or relname like 'mcp_authorization_%')"
    )
  ).rows;
  expect(tables).toHaveLength(15);
  expect(tables.every((row) => row.relrowsecurity)).toBe(true);
  const exposed = (
    await pool.query(
      "select table_name from information_schema.role_table_grants where grantee in ('anon','authenticated','PUBLIC') and (table_name like 'mcp_auth_%' or table_name like 'mcp_authorization_%')"
    )
  ).rows;
  expect(exposed).toEqual([]);
});
it('rejects a nonce appended outside the provider signed parameters', async () => {
  const c = await client();
  const response = await auth.auth.handler(
    new Request(
      issuer +
        '/oauth2/authorize?' +
        new URLSearchParams({
          response_type: 'code',
          client_id: c.client_id,
          redirect_uri: c.redirect_uris[0],
          scope: 'drasil:read',
          resource,
          code_challenge: 'A'.repeat(43),
          code_challenge_method: 'S256',
        }),
      { headers: { accept: 'application/json', cookie } }
    )
  );
  const url = new URL((await response.json()).url, origin);
  url.searchParams.set('drasil_flow', '00000000-0000-4000-8000-000000000000');
  await expect(auth.flows.createAuthorizationFlow(session, url.search.slice(1))).rejects.toThrow();
});

it('uses the maintained CIMD discovery with public DNS pinning and no redirect following', async () => {
  const metadataUrl = 'https://client.example/metadata.json';
  const metadata = {
    client_id: metadataUrl,
    client_name: 'Controlled CIMD client',
    redirect_uris: ['https://client.example/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'drasil:read offline_access',
  };
  let status = 200;
  let lookups = 0;
  let requests = 0;
  let mixed = false;
  const controlledLookup = (async () => {
    lookups++;
    return mixed
      ? [
          { address: '93.184.216.34', family: 4 },
          { address: '127.0.0.1', family: 4 },
        ]
      : [{ address: '93.184.216.34', family: 4 }];
  }) as unknown as typeof dns.lookup;
  const dnsSpy = vi.spyOn(dns, 'lookup').mockImplementation(controlledLookup);
  const httpsSpy = vi
    .spyOn(https, 'request')
    .mockImplementation((...args: Parameters<typeof https.request>) => {
      requests++;
      const [url, options, callback] = args as unknown as [
        URL,
        https.RequestOptions,
        (response: IncomingMessage) => void,
      ];
      expect(url.hostname).toBe('client.example');
      expect(options.servername).toBe('client.example');
      expect(options.headers).toMatchObject({ host: 'client.example' });
      expect(options.agent).toBe(false);
      const lookup = options.lookup as (
        host: string,
        options: { all: boolean },
        callback: (error: Error | null, address: unknown, family?: number) => void
      ) => void;
      lookup(url.hostname, { all: false }, (error, address, family) => {
        expect(error).toBeNull();
        expect(address).toBe('93.184.216.34');
        expect(family).toBe(4);
      });
      lookup(url.hostname, { all: true }, (error, address) => {
        expect(error).toBeNull();
        expect(address).toEqual([{ address: '93.184.216.34', family: 4 }]);
      });
      const request = new EventEmitter() as ClientRequest;
      request.end = (() => {
        const response = Readable.from([Buffer.from(JSON.stringify(metadata))]) as IncomingMessage;
        response.statusCode = status;
        response.headers = {
          'content-type': 'application/json',
          'cache-control': 'max-age=3600',
          ...(status === 302 ? { location: 'https://private.example/' } : {}),
        };
        callback(response);
        return request;
      }) as ClientRequest['end'];
      return request;
    });
  syncBuiltinESMExports();
  try {
    const a = await start({ client_id: metadataUrl, redirect_uris: metadata.redirect_uris });
    const grant = await select(a, '111111111111111111');
    const tokens = await exchange(a, await consent(a));
    expect((await admission(tokens)).connectionId).toBe(grant.id);
    expect(lookups).toBe(1);
    expect(requests).toBe(1);
    status = 302;
    const response = await fetchClientMetadataResource('https://client.example/redirect', {});
    expect(response.status).toBe(302);
    expect(requests).toBe(2);
    mixed = true;
    await expect(fetchClientMetadataResource('https://client.example/mixed', {})).rejects.toThrow(
      'public-routable'
    );
    expect(requests).toBe(2);
  } finally {
    dnsSpy.mockRestore();
    httpsSpy.mockRestore();
    syncBuiltinESMExports();
  }
});

it('rejects an expired provider-signed query before creating a selection', async () => {
  const a = await start(await client());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + 31 * 60 * 1000));
  try {
    await expect(auth.flows.createAuthorizationFlow(session, a.signedQuery)).rejects.toThrow();
  } finally {
    vi.useRealTimers();
  }
});
it('does not permit provider consent to expand the persisted approved subset', async () => {
  const a = await start(await client(), 'drasil:read drasil:moderate offline_access');
  await select(a, '111111111111111111', ['drasil:read', 'offline_access']);
  const code = await consent(a);
  await exchange(a, code, {}, 400);
});

it('rejects refresh when the verified Discord account relation disappears', async () => {
  const a = await start(await client());
  await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  await pool.query('delete from mcp_auth_account where "userId"=$1', [session.user.id]);
  await expect(admission(tokens)).rejects.toThrow();
  await refresh(a, tokens, 400);
});
it('disables unused grants, session JWT issuance and client administration', async () => {
  await call(
    '/oauth2/token',
    { grant_type: 'client_credentials', client_id: 'unused' },
    { anonymous: true, form: true, status: 400 }
  );
  for (const path of ['/token', '/admin/oauth2/create-client', '/oauth2/create-client']) {
    const response = await auth.handler(new Request(issuer + path, { headers: { cookie } }));
    expect(response.status).toBe(404);
  }
});

it('commits only one selection when the same flow is submitted concurrently', async () => {
  const a = await start(await client());
  const selected = await Promise.allSettled([
    select(a, '111111111111111111'),
    select(a, '222222222222222222'),
  ]);
  expect(selected.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(selected.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect((await pool.query('select id from mcp_connections')).rows).toHaveLength(1);
  expect((await pool.query('select id from mcp_authorization_references')).rows).toHaveLength(1);
});

it('serves SDK reads using real issued bearer identity and rejects expired, wrong-audience and revoked grants at HTTP admission', async () => {
  const { createMcpHandler } = await import('../server');
  const { createMcpReadTools } = await import('../tools/reads');
  const { Client: SdkClient, StreamableHTTPClientTransport } =
    await import('@modelcontextprotocol/client');
  const a = await start(await client());
  const grant = await select(a, '111111111111111111');
  const tokens = await exchange(a, await consent(a));
  const config = {
    origin,
    issuer,
    resource,
    authSecret: 'integration-continuation-'.repeat(3),
    cursorSecret: 'integration-cursor-'.repeat(3),
  };
  const execute = vi.fn(async () => ({
    kind: 'allowed' as const,
    items: [],
    nextCursor: null,
    truncated: false,
  }));
  const unused = async (): Promise<never> => {
    throw new Error('unused mutation');
  };
  const handler = createMcpHandler({
    config,
    tools: createMcpReadTools({ execute }),
    service: { submit: unused, confirm: unused, cancel: unused, status: unused },
    loadIntent: async () => null,
    verifyBearer: createBearerVerifier({ pool, config }),
  });
  const sdk = new SdkClient(
    { name: 'real-issuer-test', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await sdk.connect(
    new StreamableHTTPClientTransport(new URL(resource), {
      authProvider: { token: async () => tokens.access_token },
      fetch: async (input, init) => {
        const request = new Request(input, init);
        request.headers.set('host', 'localhost');
        return handler(request);
      },
    })
  );
  try {
    await sdk.callTool({ name: 'drasil_list_guilds', arguments: {} });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: discordId,
        clientId: a.client.client_id,
        connectionId: grant.id,
        grantVersion: 1,
        scopes: ['drasil:read'],
      }),
      expect.objectContaining({ kind: 'list_guilds' })
    );
    for (const change of [
      { exp: Math.floor(Date.now() / 1000) - 60 },
      { aud: 'https://other.example/api/mcp' },
    ]) {
      const signed = await auth.auth.api.signJWT({
        body: { payload: { ...payload(tokens), ...change } },
      });
      const response = await handler(
        new Request(resource, {
          headers: { host: 'localhost', authorization: `Bearer ${signed.token}` },
        })
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain(
        `${origin}/.well-known/oauth-protected-resource/api/mcp`
      );
    }
    await pool.query('update mcp_connections set revoked_at=now(),version=version+1 where id=$1', [
      grant.id,
    ]);
    expect(
      (
        await handler(
          new Request(resource, {
            headers: { host: 'localhost', authorization: `Bearer ${tokens.access_token}` },
          })
        )
      ).status
    ).toBe(401);
  } finally {
    await sdk.close();
  }
});
