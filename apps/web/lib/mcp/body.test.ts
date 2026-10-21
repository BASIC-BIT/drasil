import { expect, it, vi } from 'vitest';
import { wrapMcpBody } from './body';
it('bounds streamed bytes before a maintained handler can clone and parse', async () => {
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
  expect((await wrapMcpBody(next)(request)).status).toBe(413);
  expect(next).not.toHaveBeenCalled();
  expect(cancelled).toBe(true);
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
