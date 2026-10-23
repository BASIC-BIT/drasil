import { ReadDependencyUnavailableError } from '@drasil/application';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchDiscordRead, type DiscordReadDependencies } from './discordReadRecovery';
import { withReadRequestContext } from './readRequestContext';

const url = new URL('https://discord.test/api/v10/users/@me');
const decode = (response: Response): Promise<unknown> => response.json();
const ok = (): Response => new Response('{"id":"test-user"}');
const limited = (seconds = 1): Response =>
  new Response(JSON.stringify({ retry_after: seconds }), { status: 429 });

function setup(responses: (() => Promise<Response>)[]): {
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  starts: number[];
  deps: DiscordReadDependencies;
} {
  const starts: number[] = [];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    starts.push(performance.now());
    const next = responses.shift();
    if (!next) throw new Error('Unexpected extra fetch');
    return next();
  });
  return {
    fetchMock,
    starts,
    deps: { fetch: fetchMock, now: () => performance.now(), random: () => 0 },
  };
}

async function settled<T>(promise: Promise<T>): Promise<{ value: T } | { error: unknown }> {
  return promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error })
  );
}

async function runTimers<T>(promise: Promise<T>): Promise<T> {
  const result = settled(promise);
  await vi.runAllTimersAsync();
  const outcome = await result;
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Discord read recovery', () => {
  it('retries_429_once_after_server_delay', async () => {
    const { deps, fetchMock, starts } = setup([async () => limited(), async () => ok()]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).resolves.toEqual({
      id: 'test-user',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(1000);
  });

  it('does_not_retry_before_excessive_delay', async () => {
    const { deps, fetchMock } = setup([async () => limited(4)]);
    const started = performance.now();
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      name: 'ReadDependencyUnavailableError',
      retryAfterSeconds: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(performance.now() - started).toBeLessThanOrEqual(3000);
  });

  it('shares_budget_across_nested_gets', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps, starts } = setup([
      async () => limited(2),
      async () => ok(),
      async () => limited(2),
    ]);
    const result = withReadRequestContext({ operation: 'get_message_context' }, async () => {
      await fetchDiscordRead(url, {}, decode, deps);
      return fetchDiscordRead(url, {}, decode, deps);
    });
    await expect(runTimers(result)).rejects.toBeInstanceOf(ReadDependencyUnavailableError);
    expect(starts).toEqual([0, 2000, 2000]);
    expect(performance.now()).toBeLessThanOrEqual(3000);
  });

  it('parallel_queries_have_independent_budgets', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const first = setup([async () => limited(2), async () => ok()]);
    const second = setup([async () => limited(2), async () => ok()]);
    const result = Promise.all([
      withReadRequestContext({ operation: 'get_message_context' }, () =>
        fetchDiscordRead(url, {}, decode, first.deps)
      ),
      (async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return withReadRequestContext({ operation: 'get_message_context' }, () =>
          fetchDiscordRead(url, {}, decode, second.deps)
        );
      })(),
    ]);
    await expect(runTimers(result)).resolves.toHaveLength(2);
    expect(first.starts).toEqual([0, 2000]);
    expect(second.starts).toEqual([1500, 3500]);
  });

  it.each([
    ['malformed JSON', '{', {}, null],
    ['missing delay', '{}', {}, null],
    ['negative delay', '{"retry_after":-1}', {}, null],
    ['non-finite delay', '{"retry_after":1e999}', {}, null],
    ['wrong JSON type', '{"retry_after":"1"}', {}, null],
    [
      'invalid header values',
      '{}',
      { 'retry-after': '-1', 'x-ratelimit-reset-after': 'Infinity' },
      null,
    ],
    ['empty header', '{}', { 'retry-after': '' }, null],
    [
      'longest valid source',
      '{"retry_after":0.5}',
      { 'retry-after': '1', 'x-ratelimit-reset-after': '2' },
      2000,
    ],
    ['header survives invalid JSON', '{', { 'retry-after': '1' }, 1000],
    ['zero delay', '{"retry_after":0}', {}, 0],
    ['longest excessive source', '{"retry_after":6}', { 'retry-after': '4' }, null],
    ['deadline equality', '{"retry_after":3}', {}, null],
  ])('handles 429 metadata: %s', async (_name, body, headers, retryAt) => {
    const { deps, fetchMock, starts } = setup([
      async () => new Response(body, { status: 429, headers }),
      async () => ok(),
    ]);
    const result = runTimers(fetchDiscordRead(url, {}, decode, deps));
    if (retryAt === null) {
      await expect(result).rejects.toBeInstanceOf(ReadDependencyUnavailableError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } else {
      await expect(result).resolves.toEqual({ id: 'test-user' });
      expect(starts).toEqual([0, retryAt]);
    }
  });

  it('keeps the longest retry advice even when multiple delays exceed the budget', async () => {
    const { deps } = setup([
      async () =>
        new Response('{"retry_after":6}', {
          status: 429,
          headers: { 'retry-after': '4' },
        }),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      retryAfterSeconds: 6,
    });
  });

  it('starts no further GET when the shared recovery budget is exhausted', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps, fetchMock } = setup([async () => limited(1), async () => ok()]);
    const result = withReadRequestContext({ operation: 'get_message_context' }, async () => {
      await fetchDiscordRead(url, {}, decode, deps);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return fetchDiscordRead(url, {}, decode, deps);
    });
    await expect(runTimers(result)).rejects.toBeInstanceOf(ReadDependencyUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not schedule a retry when a nested GET consumes the rest of the budget', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps, fetchMock } = setup([
      async () => limited(2),
      async () => ok(),
      async () => new Promise(() => undefined),
    ]);
    const result = withReadRequestContext({ operation: 'get_message_context' }, async () => {
      await fetchDiscordRead(url, {}, decode, deps);
      return fetchDiscordRead(url, {}, decode, deps);
    });
    await expect(runTimers(result)).rejects.toBeInstanceOf(ReadDependencyUnavailableError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(performance.now()).toBe(3000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels an in-flight body without recovering caller cancellation', async () => {
    const controller = new AbortController();
    const { deps, fetchMock } = setup([async () => ok()]);
    const outcome = settled(
      fetchDiscordRead(
        url,
        { signal: controller.signal },
        async () => new Promise(() => undefined),
        deps
      )
    );
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never makes a third attempt after a second 429', async () => {
    const { deps, fetchMock } = setup([async () => limited(), async () => limited(2)]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      retryAfterSeconds: 2,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(performance.now()).toBe(1000);
  });

  it.each([502, 503, 504])('recovers HTTP %i with one bounded jitter delay', async (status) => {
    const { deps, starts } = setup([async () => new Response(null, { status }), async () => ok()]);
    await expect(
      runTimers(fetchDiscordRead(url, {}, decode, { ...deps, random: () => 1 }))
    ).resolves.toEqual({ id: 'test-user' });
    expect(starts).toEqual([0, 250]);
  });

  it.each([502, 503, 504])('waits for HTTP %i provider backoff before retrying', async (status) => {
    const { deps, starts } = setup([
      async () => new Response(null, { status, headers: { 'retry-after': '1.5' } }),
      async () => ok(),
    ]);
    const outcome = settled(fetchDiscordRead(url, {}, decode, deps));
    await vi.advanceTimersByTimeAsync(1499);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual({ value: { id: 'test-user' } });
    expect(starts).toEqual([0, 1500]);
  });

  it.each(['3', '10'])(
    'returns HTTP 503 provider advice %s without retrying at or beyond the budget',
    async (delay) => {
      const { deps, starts } = setup([
        async () => new Response(null, { status: 503, headers: { 'retry-after': delay } }),
        async () => ok(),
      ]);
      await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
        name: 'ReadDependencyUnavailableError',
        retryAfterSeconds: Number(delay),
      });
      expect(starts).toEqual([0]);
      expect(performance.now()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('returns the second HTTP 503 provider advice without a third attempt', async () => {
    const { deps, starts } = setup([
      async () => new Response(null, { status: 503, headers: { 'retry-after': '1' } }),
      async () => new Response(null, { status: 503, headers: { 'retry-after': '1.5' } }),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      retryAfterSeconds: 2,
    });
    expect(starts).toEqual([0, 1000]);
    expect(performance.now()).toBe(1000);
  });

  it('compares HTTP 503 provider backoff with the remaining shared budget', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps, starts } = setup([
      async () => limited(2),
      async () => ok(),
      async () => new Response(null, { status: 503, headers: { 'retry-after': '1.5' } }),
      async () => ok(),
    ]);
    const result = withReadRequestContext({ operation: 'get_message_context' }, async () => {
      await fetchDiscordRead(url, {}, decode, deps);
      return fetchDiscordRead(url, {}, decode, deps);
    });
    await expect(runTimers(result)).rejects.toMatchObject({ retryAfterSeconds: 2 });
    expect(starts).toEqual([0, 2000, 2000]);
    expect(performance.now()).toBe(2000);
  });

  it.each([
    ['Retry-After is longest', { 'retry-after': '2', 'x-ratelimit-reset-after': '1' }, 2000],
    ['reset header is longest', { 'retry-after': '1', 'x-ratelimit-reset-after': '2' }, 2000],
    ['zero provider delay', { 'retry-after': '0' }, 0],
    ['malformed date metadata', { 'retry-after': 'Fri, -1' }, 100],
    ['unusable metadata', { 'retry-after': '-1', 'x-ratelimit-reset-after': 'Infinity' }, 100],
  ])('handles HTTP 503 headers: %s', async (_name, headers, retryAt) => {
    const { deps, starts } = setup([
      async () => new Response(null, { status: 503, headers }),
      async () => ok(),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).resolves.toEqual({
      id: 'test-user',
    });
    expect(starts).toEqual([0, retryAt]);
  });

  it.each([
    ['Fri, 23 Oct 2026 00:00:02 GMT', 2000],
    ['Friday, 23-Oct-26 00:00:02 GMT', 2000],
    ['Fri Oct 23 00:00:02 2026', 2000],
  ])('honors HTTP-date Retry-After %s', async (retryAfter, retryAt) => {
    vi.stubEnv('TZ', 'Etc/GMT-2');
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 23));
    const { deps, starts } = setup([
      async () => new Response(null, { status: 503, headers: { 'retry-after': retryAfter } }),
      async () => ok(),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).resolves.toEqual({
      id: 'test-user',
    });
    expect(starts).toEqual([0, retryAt]);
  });

  it('applies the HTTP rolling-century rule to obsolete Retry-After dates', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 23));
    const { deps, starts } = setup([
      async () =>
        new Response(null, {
          status: 503,
          headers: { 'retry-after': 'Thursday, 23-Oct-70 00:00:02 GMT' },
        }),
      async () => ok(),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      retryAfterSeconds: 1_388_534_402,
    });
    expect(starts).toEqual([0]);
  });

  it('returns HTTP-date provider advice beyond the budget without retrying', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 23));
    const { deps, starts } = setup([
      async () =>
        new Response(null, {
          status: 503,
          headers: { 'retry-after': 'Fri, 23 Oct 2026 00:00:10 GMT' },
        }),
      async () => ok(),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toMatchObject({
      retryAfterSeconds: 10,
    });
    expect(starts).toEqual([0]);
    expect(performance.now()).toBe(0);
  });

  it('recognizes fetch transport provenance', async () => {
    const failure = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('transport'), { code: 'ECONNRESET' }),
    });
    const { deps, starts } = setup([
      async () => {
        throw failure;
      },
      async () => ok(),
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).resolves.toEqual({
      id: 'test-user',
    });
    expect(starts).toEqual([0, 100]);
  });

  it.each([401, 403, 404, 500, 501])(
    'does_not_retry_4xx_or_unknown_errors: HTTP %i',
    async (status) => {
      const failure = new Error('http failure');
      const { deps, fetchMock } = setup([async () => new Response(null, { status })]);
      await expect(
        runTimers(
          fetchDiscordRead(
            url,
            {},
            async () => {
              throw failure;
            },
            deps
          )
        )
      ).rejects.toBe(failure);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    new TypeError('arbitrary bug'),
    new Error('programming error'),
    new DOMException('caller abort', 'AbortError'),
  ])('does not retry unknown exception %s', async (failure) => {
    const { deps, fetchMock } = setup([
      async () => {
        throw failure;
      },
    ]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toBe(failure);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403, 404, 500, 501])(
    'does not retry HTTP %i when its error body stalls',
    async (status) => {
      const { deps, fetchMock } = setup([async () => new Response(null, { status })]);
      await expect(
        runTimers(fetchDiscordRead(url, {}, async () => new Promise(() => undefined), deps))
      ).rejects.toBeInstanceOf(Error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it('does not retry malformed success JSON', async () => {
    const { deps, fetchMock } = setup([async () => new Response('{')]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toBeInstanceOf(
      SyntaxError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('cancellation_stops_wait_and_fetch', async () => {
    const controller = new AbortController();
    const { deps, fetchMock } = setup([async () => limited()]);
    const outcome = settled(fetchDiscordRead(url, { signal: controller.signal }, decode, deps));
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honors inherited HTTP cancellation', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const controller = new AbortController();
    const { deps, fetchMock } = setup([async () => limited()]);
    const outcome = settled(
      withReadRequestContext({ operation: 'get_message_context', signal: controller.signal }, () =>
        fetchDiscordRead(url, {}, decode, deps)
      )
    );
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await vi.runAllTimersAsync();
    expect(await outcome).toMatchObject({ error: { name: 'AbortError' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not start a fetch after caller cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps, fetchMock } = setup([]);
    await expect(
      fetchDiscordRead(url, { signal: controller.signal }, decode, deps)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds a stalled response body through the retry deadline', async () => {
    const signals: AbortSignal[] = [];
    const { deps, fetchMock, starts } = setup([async () => ok(), async () => ok()]);
    const decodeBody = async (_response: Response): Promise<never> => new Promise(() => undefined);
    fetchMock.mockImplementation(async (_input, init) => {
      starts.push(performance.now());
      if (init?.signal) signals.push(init.signal);
      return ok();
    });
    const started = performance.now();
    await expect(runTimers(fetchDiscordRead(url, {}, decodeBody, deps))).rejects.toBeInstanceOf(
      ReadDependencyUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(starts).toEqual([0, 2100]);
    expect(performance.now() - started).toBe(5000);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a stalled 429 metadata body and closes it', async () => {
    const response = new Response(new ReadableStream({ start() {} }), {
      status: 429,
      headers: { 'retry-after': '4' },
    });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const { deps, fetchMock } = setup([async () => response]);
    await expect(runTimers(fetchDiscordRead(url, {}, decode, deps))).rejects.toBeInstanceOf(
      ReadDependencyUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(performance.now()).toBeLessThanOrEqual(3000);
    expect(cancel).toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE', 'PATCH', 'PUT'])(
    'mutation_and_oauth_requests_are_not_replayed: %s',
    async (method) => {
      const { deps, fetchMock } = setup([]);
      await expect(fetchDiscordRead(url, { method }, decode, deps)).rejects.toThrow(/GET/);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it('records one correlated diagnostic per attempt without provider payloads', async () => {
    const logs = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { deps } = setup([async () => limited(), async () => ok()]);
    await runTimers(
      withReadRequestContext({ operation: 'get_message_context' }, () =>
        fetchDiscordRead(url, {}, decode, deps)
      )
    );
    const events = logs.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(events).toMatchObject([
      { dependency: 'discord', status: 429, category: 'http_rate_limited', attempt: 1 },
      { dependency: 'discord', status: 200, category: 'success', attempt: 2 },
    ]);
    expect(events[0].correlationId).toBe(events[1].correlationId);
    expect(JSON.stringify(events)).not.toContain('test-user');
  });
});
