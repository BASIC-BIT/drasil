import { expect, it, vi } from 'vitest';
vi.mock('@/lib/mcp/endpoint', () => ({
  handleMcpRequest: vi.fn(async () => new Response('forwarded')),
}));
import { GET, POST, DELETE, runtime } from './route';
import { handleMcpRequest } from '@/lib/mcp/endpoint';
import { GET as metadata } from '../../.well-known/oauth-protected-resource/route';
import { GET as alias } from '../../.well-known/oauth-protected-resource/api/mcp/route';
it('forwards all transport verbs through the Node entrypoint', async () => {
  expect(runtime).toBe('nodejs');
  for (const handler of [GET, POST, DELETE]) {
    const request = new Request('https://example.test/api/mcp');
    expect(await (await handler(request)).text()).toBe('forwarded');
    expect(handleMcpRequest).toHaveBeenCalledWith(request);
  }
});
it('has one lazy disabled metadata owner at both aliases', async () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'false');
  expect(alias).toBe(metadata);
  expect(
    (await metadata(new Request('https://example.test/.well-known/oauth-protected-resource')))
      .status
  ).toBe(404);
  vi.unstubAllEnvs();
});
it('returns identical fixed resource metadata regardless of either alias request URL', async () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mcp.example.test');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRET', 'a'.repeat(40));
  vi.stubEnv('DRASIL_MCP_CURSOR_SECRET', 'b'.repeat(40));
  try {
    const first = await metadata(
      new Request('https://untrusted.test/.well-known/oauth-protected-resource')
    );
    const second = await alias(
      new Request('https://another.test/.well-known/oauth-protected-resource/api/mcp')
    );
    expect(await first.json()).toEqual(await second.json());
    expect(await (await alias(new Request('https://untrusted.test/alias'))).json()).toMatchObject({
      resource: 'https://mcp.example.test/api/mcp',
      authorization_servers: ['https://mcp.example.test/api/mcp-auth'],
    });
  } finally {
    vi.unstubAllEnvs();
  }
});
