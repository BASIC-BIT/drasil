import { afterEach, expect, it, vi } from 'vitest';
import { createRequestStateCodec, type ServerContext } from '@drasil/mcp-runtime/server';
import { currentReadRequestContext, withReadRequestContext } from '../readRequestContext';
import { createObservedRequestStateCodec } from './continuationDiagnostics';

afterEach(() => vi.restoreAllMocks());
const key = 'k'.repeat(40);
const privatePayload = {
  command: 'COMMAND_SENTINEL',
  summary: 'SUMMARY_SENTINEL',
  guildId: 'GUILD_SENTINEL',
};
function context(id = 'PRINCIPAL_SENTINEL'): ServerContext {
  const unused = async (): Promise<never> => {
    throw new Error('unused');
  };
  return {
    mcpReq: {
      id,
      method: 'tools/call',
      signal: new AbortController().signal,
      requestState: () => undefined,
      send: unused,
      notify: unused,
      log: unused,
      elicitInput: unused,
      requestSampling: unused,
      envelope: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' },
    },
  };
}

it('retains the real codec result and logs safe correlated mint and verify success', async () => {
  const lines: string[] = [];
  const codec = createObservedRequestStateCodec(
    { key, ttlSeconds: 600, bind: (ctx) => String(ctx.mcpReq.id) },
    (line) => lines.push(line)
  );
  await withReadRequestContext({ operation: 'mcp_http' }, async () => {
    const state = await codec.mint(privatePayload, context());
    expect(await codec.verify(state, context())).toEqual(privatePayload);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({
        event: 'mcp_continuation',
        stage: 'mint',
        outcome: 'success',
        reason: 'none',
        correlationId: currentReadRequestContext()!.correlationId,
        stateType: 'string',
        protocol: '2026-07-28',
      }),
      expect.objectContaining({
        event: 'mcp_continuation',
        stage: 'verify',
        outcome: 'success',
        reason: 'none',
        correlationId: currentReadRequestContext()!.correlationId,
        stateType: 'string',
        protocol: '2026-07-28',
      }),
    ]);
    expect(lines.join()).not.toContain(state);
    expect(lines.join()).not.toContain(state.split('.').at(-1));
  });
  expect(lines.join()).not.toMatch(
    /COMMAND_SENTINEL|SUMMARY_SENTINEL|GUILD_SENTINEL|PRINCIPAL_SENTINEL/
  );
});

it.each(['malformed', 'mac', 'expired', 'bind'] as const)(
  'classifies the real codec %s rejection',
  async (reason) => {
    const lines: string[] = [];
    const codec = createObservedRequestStateCodec(
      { key, ttlSeconds: 600, bind: (ctx) => String(ctx.mcpReq.id) },
      (line) => lines.push(line)
    );
    let state = await codec.mint(privatePayload, context());
    if (reason === 'malformed') state = 'PRIVATE_STATE';
    if (reason === 'mac')
      state = await createRequestStateCodec({ key: 'x'.repeat(40) }).mint(privatePayload);
    if (reason === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
    await expect(
      codec.verify(state, context(reason === 'bind' ? 'OTHER_PRINCIPAL' : undefined))
    ).rejects.toThrow(reason);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({
      stage: 'verify',
      outcome: 'failure',
      reason,
    });
    expect(lines.join()).not.toMatch(
      /PRIVATE_STATE|COMMAND_SENTINEL|SUMMARY_SENTINEL|GUILD_SENTINEL|PRINCIPAL_SENTINEL|OTHER_PRINCIPAL/
    );
  }
);

it('classifies unavailable binding context while preserving the original exception identity', async () => {
  const original = new Error('PRIVATE_CONTEXT');
  const lines: string[] = [];
  let available = true;
  const codec = createObservedRequestStateCodec(
    {
      key,
      bind: () => {
        if (!available) throw original;
        return 'PRIVATE_BINDING';
      },
    },
    (line) => lines.push(line)
  );
  const state = await codec.mint(privatePayload, context());
  available = false;
  await expect(codec.verify(state, context())).rejects.toBe(original);
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({
    stage: 'verify',
    outcome: 'failure',
    reason: 'context',
  });
  await expect(codec.mint(privatePayload, context())).rejects.toBe(original);
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({
    stage: 'mint',
    outcome: 'failure',
    reason: 'context',
  });
  expect(lines.join()).not.toMatch(/PRIVATE_CONTEXT|PRIVATE_BINDING/);
});

it('does not read hostile error properties or serialize unknown exceptions', async () => {
  const lines: string[] = [];
  const original = Object.defineProperty(new Error(), 'message', {
    get: () => {
      throw new Error('PRIVATE_GETTER');
    },
  });
  const codec = createObservedRequestStateCodec({ key }, (line) => lines.push(line));
  const state = await codec.mint(privatePayload);
  vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(original);
  await expect(codec.verify(state, context())).rejects.toBe(original);
  expect(JSON.parse(lines.at(-1)!)).toMatchObject({
    stage: 'verify',
    outcome: 'failure',
    reason: 'unknown',
  });
  expect(lines.join()).not.toMatch(/PRIVATE_GETTER/);
});

it('keeps successful values and original errors when the sink throws', async () => {
  const codec = createObservedRequestStateCodec({ key }, () => {
    throw new Error('PRIVATE_SINK');
  });
  const state = await codec.mint(privatePayload);
  expect(await codec.verify(state, context())).toEqual(privatePayload);
  const original = new Error('PRIVATE_CRYPTO');
  vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(original);
  await expect(codec.verify(state, context())).rejects.toBe(original);
});

it('uses independent current correlations across concurrent codec operations', async () => {
  const lines: string[] = [];
  const codec = createObservedRequestStateCodec({ key }, (line) => lines.push(line));
  await Promise.all(
    [0, 1].map(() =>
      withReadRequestContext({ operation: 'mcp_http' }, async () => {
        const state = await codec.mint(privatePayload, context());
        await codec.verify(state, context());
      })
    )
  );
  const events = lines.map((line) => JSON.parse(line));
  const ids = [...new Set(events.map((event) => event.correlationId))];
  expect(ids).toHaveLength(2);
  for (const id of ids)
    expect(
      events.filter((event) => event.correlationId === id).map((event) => event.stage)
    ).toEqual(['mint', 'verify']);
});

it.each([new Error('ERROR_SENTINEL'), 'THROWN_SENTINEL', null, 17])(
  'preserves arbitrary original verification exceptions as unknown categories',
  async (original) => {
    const lines: string[] = [];
    const codec = createObservedRequestStateCodec({ key }, (line) => lines.push(line));
    const state = await codec.mint(privatePayload);
    vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(original);
    await expect(codec.verify(state, context())).rejects.toBe(original);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ reason: 'unknown' });
    expect(lines.join()).not.toMatch(/ERROR_SENTINEL|THROWN_SENTINEL/);
  }
);

it('keeps binding failure categories local to concurrent operations, including primitive throws', async () => {
  const lines: string[] = [];
  const codec = createObservedRequestStateCodec(
    {
      key,
      bind: (ctx) => {
        if (ctx.mcpReq.id === 'unavailable') throw 'CONTEXT_SENTINEL';
        return 'PRIVATE_BINDING';
      },
    },
    (line) => lines.push(line)
  );
  const state = await codec.mint(privatePayload, context());
  const values = await Promise.allSettled([
    codec.verify(state, context('unavailable')),
    codec.verify('PRIVATE_STATE', context()),
    codec.verify(state, context()),
  ]);
  expect(values[0]).toEqual({ status: 'rejected', reason: 'CONTEXT_SENTINEL' });
  expect(values[1]).toMatchObject({ status: 'rejected', reason: expect.any(Error) });
  expect(values[2]).toEqual({ status: 'fulfilled', value: privatePayload });
  expect(
    lines
      .slice(1)
      .map((line) => JSON.parse(line).reason)
      .sort()
  ).toEqual(['context', 'malformed', 'none']);
  expect(lines.join()).not.toMatch(/CONTEXT_SENTINEL|PRIVATE_BINDING|PRIVATE_STATE/);
  const throwing = createObservedRequestStateCodec(
    {
      key,
      bind: () => {
        throw 'CONTEXT_SENTINEL';
      },
    },
    () => {
      throw 'SINK_SENTINEL';
    }
  );
  await expect(throwing.mint(privatePayload, context())).rejects.toBe('CONTEXT_SENTINEL');
  await expect(throwing.verify(state, context())).rejects.toBe('CONTEXT_SENTINEL');
});

it('bounds state byte counts and does not echo unknown protocol values or extra fields', async () => {
  const lines: string[] = [];
  const codec = createObservedRequestStateCodec({ key }, (line) => lines.push(line));
  const ctx = context();
  ctx.mcpReq.envelope = {
    'io.modelcontextprotocol/protocolVersion': 'PROTOCOL_SENTINEL'.repeat(1000),
  };
  await expect(codec.verify('STATE_SENTINEL'.repeat(400_000), ctx)).rejects.toThrow('malformed');
  expect(JSON.parse(lines[0])).toEqual({
    event: 'mcp_continuation',
    stage: 'verify',
    outcome: 'failure',
    reason: 'malformed',
    correlationId: 'unavailable',
    protocol: 'unknown',
    stateType: 'string',
    stateBytes: 4 * 1024 * 1024,
  });
  expect(lines[0]).not.toMatch(/STATE_SENTINEL|PROTOCOL_SENTINEL/);
});

it('keeps codec results and errors when diagnostic context access throws', async () => {
  const codec = createObservedRequestStateCodec({ key }, () => {
    throw new Error('SINK_SENTINEL');
  });
  const ctx = context();
  Object.defineProperty(ctx.mcpReq, 'envelope', {
    get: () => {
      throw new Error('CONTEXT_SENTINEL');
    },
  });
  const state = await codec.mint(privatePayload, ctx);
  expect(await codec.verify(state, ctx)).toEqual(privatePayload);
  const original = new Error('CRYPTO_SENTINEL');
  vi.spyOn(crypto.subtle, 'verify').mockRejectedValue(original);
  await expect(codec.verify(state, ctx)).rejects.toBe(original);
});
