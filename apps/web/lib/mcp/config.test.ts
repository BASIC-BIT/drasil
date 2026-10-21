import { afterEach, expect, it, vi } from 'vitest';
import { getMcpConfig } from './config';
afterEach(() => vi.unstubAllEnvs());
it('defaults to disabled without new secrets', () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', '');
  expect(getMcpConfig()).toBeNull();
});
it('requires secrets and a configured trusted origin when enabled', () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
  vi.stubEnv('DRASIL_WEB_PUBLIC_URL', '');
  expect(() => getMcpConfig()).toThrow();
});
it('derives endpoints only from the configured origin and enforces HTTPS', () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'true');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRET', 'a'.repeat(48));
  vi.stubEnv('DRASIL_MCP_CURSOR_SECRET', 'b'.repeat(48));
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
  vi.stubEnv('NODE_ENV', 'production');
  expect(getMcpConfig()).toMatchObject({
    issuer: 'https://drasil.example/api/mcp-auth',
    resource: 'https://drasil.example/api/mcp',
  });
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
  expect(() => getMcpConfig()).toThrow();
  vi.stubEnv('NODE_ENV', 'development');
  expect(getMcpConfig()?.origin).toBe('http://localhost:3000');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://public.example');
  expect(() => getMcpConfig()).toThrow();
});
it('imports disabled issuer routes without auth secrets', async () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'false');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRET', '');
  const issuer = await import('./auth/issuer');
  expect(issuer.getMcpIssuer()).toBeNull();
  const principal = await import('./auth/principal');
  await expect(
    principal.verifyMcpPrincipal(new Request('http://localhost/api/mcp'))
  ).rejects.toThrow();
  const route = await import('../../app/api/mcp-auth/[...all]/route');
  expect((await route.GET(new Request('http://localhost/api/mcp-auth/jwks'))).status).toBe(404);
  const discovery =
    await import('../../app/.well-known/oauth-authorization-server/api/mcp-auth/route');
  expect(
    (
      await discovery.GET(
        new Request('http://localhost/.well-known/oauth-authorization-server/api/mcp-auth')
      )
    ).status
  ).toBe(404);
});
it('validates an explicit MCP-owned rotation ring and separate operational keys', () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://drasil.example');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRET', 'a'.repeat(40));
  vi.stubEnv('DRASIL_MCP_CURSOR_SECRET', 'b'.repeat(40));
  vi.stubEnv('DRASIL_MCP_IP_HASH_SECRET', 'c'.repeat(40));
  vi.stubEnv(
    'DRASIL_MCP_AUTH_SECRETS',
    JSON.stringify([
      { version: 2, value: 'd'.repeat(40) },
      { version: 1, value: 'a'.repeat(40) },
    ])
  );
  expect(getMcpConfig()?.authSecrets?.map((e) => e.version)).toEqual([2, 1]);
  vi.stubEnv(
    'DRASIL_MCP_AUTH_SECRETS',
    JSON.stringify([
      { version: 2, value: 'd'.repeat(40) },
      { version: 2, value: 'a'.repeat(40) },
    ])
  );
  expect(() => getMcpConfig()).toThrow('Duplicate');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRETS', '');
  vi.stubEnv('DRASIL_MCP_IP_HASH_SECRET', 'b'.repeat(40));
  expect(() => getMcpConfig()).toThrow('distinct');
});
