import { expect, it, vi } from 'vitest';
import { handleMcpRequest } from './endpoint';
import { createMcpHandler } from './server';
it('keeps the production endpoint disabled without credentials by default', async () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', undefined);
  try {
    expect((await handleMcpRequest(new Request('https://example.test/api/mcp'))).status).toBe(404);
  } finally {
    vi.unstubAllEnvs();
  }
});
it('provides the operational body wrapper before maintained JSON parsing or authentication', async () => {
  const verifyBearer = vi.fn();
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  const handler = createMcpHandler({
    config: {
      origin: 'https://example.test',
      resource: 'https://example.test/api/mcp',
      issuer: 'https://example.test/api/mcp-auth',
      authSecret: 'a'.repeat(40),
      cursorSecret: 'b'.repeat(40),
    },
    tools: [],
    service: { submit: unused, confirm: unused, cancel: unused, status: unused },
    loadIntent: async () => null,
    verifyBearer,
    wrapBody: () => async (request) => {
      expect(request.bodyUsed).toBe(false);
      expect(await request.text()).toBe('{ oversized invalid JSON');
      return new Response(null, { status: 413 });
    },
  });
  expect(
    (
      await handler(
        new Request('https://example.test/api/mcp', {
          method: 'POST',
          headers: { host: 'example.test', 'content-type': 'application/json' },
          body: '{ oversized invalid JSON',
        })
      )
    ).status
  ).toBe(413);
  expect(verifyBearer).not.toHaveBeenCalled();
});
