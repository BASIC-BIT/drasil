import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { afterEach, expect, it, vi } from 'vitest';
import { verifyOAuthQueryParams } from '@drasil/mcp-runtime/oauth-provider';
import { AuthorizationFlowError, createAuthorizationFlowService } from './flows';

const config = {
  origin: 'https://drasil.example',
  issuer: 'https://drasil.example/api/mcp-auth',
  resource: 'https://drasil.example/api/mcp',
  authSecret: 'synthetic-test-signing-secret',
  cursorSecret: 'synthetic-test-cursor-secret',
};
const session = { user: { id: 'user' }, session: { id: 'session', userId: 'user' } };
afterEach(() => vi.restoreAllMocks());

function signedQuery(scope: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: 'https://client.example/oauth/client-metadata.json',
    redirect_uri: 'https://client.example/api/oauth/callback',
    scope,
    code_challenge: 'A'.repeat(43),
    code_challenge_method: 'S256',
    resource: config.resource,
    drasil_flow: '00000000-0000-4000-8000-000000000001',
    exp: String(Math.floor(Date.now() / 1000) + 600),
    ba_iat: String(Date.now()),
  });
  for (const name of [...params.keys(), 'ba_param'].sort()) params.append('ba_param', name);
  const canonical = new URLSearchParams(
    [...params.entries()].sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
  );
  params.set(
    'sig',
    createHmac('sha256', config.authSecret).update(canonical.toString()).digest('base64')
  );
  return params.toString();
}

it('rejects an unexpired signed offline-only URL-client flow before session or persistence', async () => {
  const pool = new Pool();
  const query = vi.spyOn(pool, 'query').mockRejectedValue(new Error('session lookup reached'));
  const request = signedQuery('offline_access');
  expect(await verifyOAuthQueryParams(request, config.authSecret)).toBe(true);
  await expect(
    createAuthorizationFlowService(pool, config).createAuthorizationFlow(session, request)
  ).rejects.toBeInstanceOf(AuthorizationFlowError);
  expect(query).not.toHaveBeenCalled();
  await pool.end();
});

it('accepts the same signed URL-client shape with a resource scope up to the live session check', async () => {
  const pool = new Pool();
  const query = vi.spyOn(pool, 'query').mockRejectedValue(new Error('session lookup reached'));
  const request = signedQuery('drasil:read offline_access');
  expect(await verifyOAuthQueryParams(request, config.authSecret)).toBe(true);
  await expect(
    createAuthorizationFlowService(pool, config).createAuthorizationFlow(session, request)
  ).rejects.toThrow('session lookup reached');
  expect(query).toHaveBeenCalledTimes(1);
  await pool.end();
});
