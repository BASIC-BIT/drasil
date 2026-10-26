import { expect, it, vi } from 'vitest';
import { wrapMcpBody } from './body';
import { withReadRequestContext } from '../readRequestContext';

it.each(
  [null, false, 42, [], { private: 'STATE_SENTINEL' }, 'STATE_SENTINEL'].map((state) => ({ state }))
)('observes only the type and bounded size of present wire state %j', async ({ state }) => {
  const lines: string[] = [];
  const text = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      requestState: state,
      _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
      arguments: { command: 'COMMAND_SENTINEL', summary: 'SUMMARY_SENTINEL' },
    },
  });
  const next = async (request: Request) => new Response(await request.text());
  const response = await withReadRequestContext({ operation: 'mcp_http' }, () =>
    wrapMcpBody(next, (line) => lines.push(line))(
      new Request('https://example/api/mcp', {
        method: 'POST',
        headers: { authorization: 'Bearer TOKEN_SENTINEL' },
        body: text,
      })
    )
  );
  expect(await response.text()).toBe(text);
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({
    event: 'mcp_continuation',
    stage: 'wire',
    outcome: 'present',
    reason: typeof state === 'string' ? 'none' : 'malformed',
    protocol: '2026-07-28',
  });
  expect(lines.join()).not.toMatch(
    /STATE_SENTINEL|COMMAND_SENTINEL|SUMMARY_SENTINEL|TOKEN_SENTINEL/
  );
});

it('leaves malformed JSON and unsupported state locations to the SDK without observations', async () => {
  const lines: string[] = [];
  for (const text of ['{broken', '{"params":{"_meta":{"requestState":"PRIVATE"}}}', '{}']) {
    const response = await wrapMcpBody(
      async (r) => new Response(await r.text()),
      (line) => lines.push(line)
    )(new Request('https://example/api/mcp', { method: 'POST', body: text }));
    expect(await response.text()).toBe(text);
  }
  expect(lines).toEqual([]);
});

it('ignores observer exceptions without swallowing the original downstream error', async () => {
  const original = new Error('PRIVATE_DOWNSTREAM');
  await expect(
    wrapMcpBody(
      async () => {
        throw original;
      },
      () => {
        throw new Error('PRIVATE_SINK');
      }
    )(
      new Request('https://example/api/mcp', {
        method: 'POST',
        body: '{"params":{"requestState":null}}',
      })
    )
  ).rejects.toBe(original);
});
it('bounds streamed bytes before a maintained handler can clone and parse', async () => {
  const lines: string[] = [];
  const next = vi.fn(async (request: Request) => {
    await request.clone().json();
    return new Response(null, { status: 204 });
  });
  let cancelled = false;
  const request = new Request('https://example/api/mcp', {
    method: 'POST',
    body: new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    }),
    duplex: 'half',
  } as RequestInit);
  expect((await wrapMcpBody(next, (line) => lines.push(line))(request)).status).toBe(413);
  expect(next).not.toHaveBeenCalled();
  expect(cancelled).toBe(true);
  expect(lines).toEqual([]);
});
it('keeps the maintained four MiB default distinct from result budgets', async () => {
  const text = JSON.stringify({ text: 'x'.repeat(70_000) });
  const next = vi.fn(async (r: Request) => Response.json(await r.clone().json()));
  expect(
    await (
      await wrapMcpBody(next)(
        new Request('https://example/api/mcp', { method: 'POST', body: text })
      )
    ).json()
  ).toEqual(JSON.parse(text));
});
it('propagates stream failures and leaves unsupported methods to the handler', async () => {
  const error = new Error('broken stream');
  const next = vi.fn(async () => new Response(null, { status: 405 }));
  await expect(
    wrapMcpBody(next)(
      new Request('https://example/api/mcp', {
        method: 'POST',
        body: new ReadableStream({
          start(c) {
            c.error(error);
          },
        }),
        duplex: 'half',
      } as RequestInit)
    )
  ).rejects.toThrow('broken stream');
  expect(
    (await wrapMcpBody(next)(new Request('https://example/api/mcp', { method: 'DELETE' }))).status
  ).toBe(405);
});
it('reconstructs a Next-style proxied request after bounded reading', async () => {
  const controller = new AbortController();
  const native = new Request('https://example/api/mcp', {
    method: 'POST',
    headers: { authorization: 'Bearer controlled', 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 }),
    signal: controller.signal,
  });
  const request = new Proxy(native, { get: (target, key) => Reflect.get(target, key, target) });
  let forwarded: Request | undefined;
  const response = await wrapMcpBody(async (r) => {
    forwarded = r;
    return Response.json(await r.clone().json());
  })(request);
  expect(await response.json()).toMatchObject({ method: 'tools/list' });
  expect(forwarded?.url).toBe(native.url);
  expect(forwarded?.method).toBe('POST');
  expect(forwarded?.headers.get('authorization')).toBe('Bearer controlled');
  controller.abort();
  expect(forwarded?.signal.aborted).toBe(true);
});
