import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { withReadRequestContext } from '../readRequestContext';
import { guildId, principal } from './queryTestFixtures';
import { channelId, messageId, readReliabilityFixture } from './readReliabilityFixtures';
import type { McpQuery } from './queries';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const caseQuery = { kind: 'list_cases', guildId, limit: 25 } as const;
const detectionQuery = { kind: 'list_detections', guildId, limit: 25 } as const;
const messageQuery = { kind: 'get_message_context', guildId, channelId, limit: 25 } as const;

it('parallel_reads_recover_without_changing_authority', async () => {
  const h = readReliabilityFixture();
  const inputs = [caseQuery, detectionQuery, messageQuery];
  for (const query of inputs)
    h.failures.set(query.kind, {
      path: `/guilds/${guildId}`,
      remaining: 1,
      delaySeconds: 1,
    });
  const pending = Promise.all(
    inputs.map((query) =>
      withReadRequestContext({ operation: query.kind }, () => h.queries.execute(principal, query))
    )
  );
  await vi.advanceTimersByTimeAsync(999);
  expect(h.repository.read).not.toHaveBeenCalled();
  expect(h.messages).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject([
    { kind: 'allowed', items: [{ id: 'list_cases' }] },
    { kind: 'allowed', items: [{ id: 'list_detections' }] },
    { kind: 'allowed', items: [{ id: messageId, content: 'Local message fixture' }] },
  ]);
  for (const query of inputs) {
    const attempts = h.attempts.filter(
      (attempt) => attempt.operation === query.kind && attempt.path === `/guilds/${guildId}`
    );
    // Message visibility reauthorizes, then loads its own fresh guild facts.
    expect(attempts.map((attempt) => attempt.at)).toEqual(
      query.kind === 'get_message_context' ? [0, 1000, 1000, 1000] : [0, 1000]
    );
  }
  expect(h.repository.read).toHaveBeenCalledTimes(2);
  expect(h.messages).toHaveBeenCalledTimes(1);
  expect(performance.now()).toBe(1000);
  const events = vi.mocked(console.info).mock.calls.map(([line]) => JSON.parse(line));
  const correlations = inputs.map((query) => {
    const recovered = events.filter(
      (event) => event.operation === query.kind && event.attempt === 2
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      boundary: 'discord_get',
      category: 'success',
      status: 200,
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        correlationId: recovered[0].correlationId,
        operation: query.kind,
        boundary: 'discord_get',
        attempt: 1,
        status: 429,
        category: 'http_rate_limited',
      })
    );
    return recovered[0].correlationId;
  });
  expect(new Set(correlations).size).toBe(3);
});

it.each(['grant', 'roles', 'channel'] as const)(
  'revoked_grant_and_changed_roles_are_not_reused_after_recovery: %s',
  async (change) => {
    const h = readReliabilityFixture();
    h.failures.set(messageQuery.kind, {
      path: `/channels/${channelId}`,
      remaining: 1,
      delaySeconds: 1,
    });
    const run = (query: McpQuery) =>
      withReadRequestContext({ operation: query.kind }, () => h.queries.execute(principal, query));
    const recovered = run(messageQuery);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await recovered).toMatchObject({ kind: 'allowed', items: [{ id: messageId }] });
    h.repository.read.mockClear();
    h.messages.mockClear();
    const previousAttempts = h.attempts.length;
    if (change === 'grant') h.grant.revokedAt = new Date();
    if (change === 'roles') h.state.staff = false;
    if (change === 'channel') h.state.visible = false;
    expect(await run(messageQuery)).toEqual({
      kind: 'denied',
      reason: change === 'grant' ? 'invalid_grant' : 'permission_denied',
    });
    if (change !== 'channel')
      expect(await run(caseQuery)).toEqual({
        kind: 'denied',
        reason: change === 'grant' ? 'invalid_grant' : 'permission_denied',
      });
    expect(h.repository.read).not.toHaveBeenCalled();
    expect(h.messages).not.toHaveBeenCalled();
    const freshPaths = h.attempts.slice(previousAttempts).map((attempt) => attempt.path);
    if (change === 'grant') expect(freshPaths).toEqual([]);
    if (change === 'roles')
      expect(freshPaths).toContain(`/guilds/${guildId}/members/${principal.userId}`);
    if (change === 'channel') expect(freshPaths).toContain(`/channels/${channelId}`);
  }
);

it('one_cancelled_query_does_not_cancel_its_sibling', async () => {
  const h = readReliabilityFixture();
  const cancelled = new AbortController();
  const sibling = new AbortController();
  for (const query of [caseQuery, detectionQuery])
    h.failures.set(query.kind, { path: `/guilds/${guildId}`, remaining: 1, delaySeconds: 1 });
  const run = (query: McpQuery, signal: AbortSignal) =>
    withReadRequestContext({ operation: query.kind, signal }, () =>
      h.queries.execute(principal, query)
    );
  const first = run(caseQuery, cancelled.signal);
  const second = run(detectionQuery, sibling.signal);
  await vi.advanceTimersByTimeAsync(500);
  cancelled.abort();
  expect(await first).toEqual({ kind: 'denied', reason: 'unavailable' });
  await vi.advanceTimersByTimeAsync(500);
  expect(await second).toMatchObject({ kind: 'allowed', items: [{ id: 'list_detections' }] });
  expect(sibling.signal.aborted).toBe(false);
  expect(h.repository.read).toHaveBeenCalledTimes(1);
  expect(
    h.attempts.filter(
      (attempt) => attempt.operation === 'list_cases' && attempt.path === `/guilds/${guildId}`
    )
  ).toHaveLength(1);
  expect(
    h.attempts
      .filter(
        (attempt) =>
          attempt.operation === 'list_detections' && attempt.path === `/guilds/${guildId}`
      )
      .map((attempt) => attempt.at)
  ).toEqual([0, 1000]);
});
