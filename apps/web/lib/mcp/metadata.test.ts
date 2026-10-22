import { expect, it, vi } from 'vitest';
import { boundMetadataTransport } from './metadata';
it('holds shared permits through headers and streamed body EOF', async () => {
  const release = vi.fn(async () => {});
  let close: () => void = () => {};
  const transport = boundMetadataTransport(
    async () => release,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{}'));
            close = () => c.close();
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
  );
  const response = await transport('https://client.example');
  expect(release).not.toHaveBeenCalled();
  const body = response.text();
  expect(release).not.toHaveBeenCalled();
  close();
  await body;
  expect(release).toHaveBeenCalledTimes(1);
});
it('does not release an unresolved transport merely because caller aborts', async () => {
  const release = vi.fn(async () => {});
  let finish: (r: Response) => void = () => {};
  const transport = boundMetadataTransport(
    async () => release,
    () =>
      new Promise((r) => {
        finish = r;
      })
  );
  const controller = new AbortController();
  const pending = transport('https://client.example', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  finish(new Response('{}', { headers: { 'content-type': 'application/json' } }));
  const response = await pending;
  await response.text();
  expect(release).toHaveBeenCalledTimes(1);
});
it('releases after proven cancellation and transport rejection', async () => {
  const release = vi.fn(async () => {});
  let cancelFinish: () => void = () => {};
  const transport = boundMetadataTransport(
    async () => release,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            return new Promise<void>((r) => {
              cancelFinish = r;
            });
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
  );
  const response = await transport('https://client.example');
  const cancellation = response.body!.cancel();
  await Promise.resolve();
  expect(release).not.toHaveBeenCalled();
  cancelFinish();
  await cancellation;
  expect(release).toHaveBeenCalledTimes(1);
  await expect(
    boundMetadataTransport(
      async () => release,
      async () => {
        throw new Error('network');
      }
    )('https://client.example')
  ).rejects.toThrow('network');
  expect(release).toHaveBeenCalledTimes(2);
});

it.each([204, 205, 304])('releases semantic bodyless HTTP completion %s', async (status) => {
  const release = vi.fn(async () => {});
  const transport = boundMetadataTransport(
    async () => release,
    async () => new Response(null, { status })
  );
  await transport('https://client.example');
  expect(release).toHaveBeenCalledTimes(1);
});
it('releases the maintained HEAD null-body contract', async () => {
  const release = vi.fn(async () => {});
  await boundMetadataTransport(
    async () => release,
    async () => new Response(null)
  )(new Request('https://client.example', { method: 'HEAD' }));
  expect(release).toHaveBeenCalledTimes(1);
});
it.each([
  { status: 200, media: 'text/json' },
  { status: 200, media: 'application/jsonx' },
  { status: 200, media: '' },
  { status: 302, media: 'application/json' },
  { status: 500, media: 'application/json' },
  { status: 200, media: 'application/json', redirected: true },
])(
  'cancels common rejected headers without any consumer: %j',
  async ({ status, media, redirected }) => {
    const cancel = vi.fn(async () => {});
    const release = vi.fn(async () => {});
    const response = new Response(new ReadableStream({ cancel }), {
      status,
      headers: { 'content-type': media },
    });
    if (redirected) Object.defineProperty(response, 'redirected', { value: true });
    expect(
      await boundMetadataTransport(
        async () => release,
        async () => response
      )('https://client.example')
    ).toBe(response);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  }
);
it('cancels rejected media before returning and retains unexpected null bodies', async () => {
  const release = vi.fn(async () => {});
  let cancelled = false;
  const transport = boundMetadataTransport(
    async () => release,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'text/html' } }
      )
  );
  await transport('https://client.example');
  expect(cancelled).toBe(true);
  expect(release).toHaveBeenCalledTimes(1);
  await boundMetadataTransport(
    async () => release,
    async () => new Response(null, { status: 200 })
  )('https://client.example');
  expect(release).toHaveBeenCalledTimes(1);
});
it('retains a permit when rejected-body cancellation fails', async () => {
  const release = vi.fn(async () => {});
  await expect(
    boundMetadataTransport(
      async () => release,
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              throw new Error('cancel failed');
            },
          }),
          { status: 302 }
        )
    )('https://client.example')
  ).rejects.toThrow('cancel failed');
  expect(release).not.toHaveBeenCalled();
});
it.each([
  'application/json',
  'APPLICATION/JSON ; charset=utf-8',
  'application/problem+json',
  'application/vnd.example+json',
])('preserves maintained accepted media %s', async (media) => {
  const release = vi.fn(async () => {});
  const response = await boundMetadataTransport(
    async () => release,
    async () => new Response('{}', { headers: { 'content-type': media } })
  )('https://client.example');
  expect(await response.text()).toBe('{}');
  expect(release).toHaveBeenCalledTimes(1);
});
it('observes underlying errors even when the consumer never reads', async () => {
  const release = vi.fn(async () => {});
  let fail: () => void = () => {};
  await boundMetadataTransport(
    async () => release,
    async () =>
      new Response(
        new ReadableStream({
          start(c) {
            fail = () => c.error(new Error('broken'));
          },
        }),
        { headers: { 'content-type': 'application/json' } }
      )
  )('https://client.example');
  fail();
  await new Promise((r) => setImmediate(r));
  expect(release).toHaveBeenCalledTimes(1);
});
