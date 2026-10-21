import { expect, it, vi } from 'vitest';
vi.mock('./actionService', () => ({
  createWebMcpActionService: () => ({
    submit: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    status: vi.fn(),
  }),
}));
vi.mock('./tools/reads', () => ({ createWebMcpReadTools: () => [] }));
vi.mock('./adapters/database', () => ({
  createWebDelegationDatabase: () => ({ query: vi.fn(), transaction: vi.fn() }),
}));
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

it('bounds the actual production endpoint before its maintained pre-parser', async () => {
  vi.stubEnv('DRASIL_MCP_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.test');
  vi.stubEnv('DRASIL_MCP_AUTH_SECRET', 'a'.repeat(40));
  vi.stubEnv('DRASIL_MCP_CURSOR_SECRET', 'b'.repeat(40));
  try {
    const response = await handleMcpRequest(
      new Request('https://example.test/api/mcp', {
        method: 'POST',
        headers: {
          host: 'example.test',
          'content-type': 'application/json',
          'content-length': String(4 * 1024 * 1024 + 1),
        },
        body: '{ invalid',
      })
    );
    expect(response.status).toBe(413);
  } finally {
    vi.unstubAllEnvs();
  }
});
