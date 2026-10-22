import { describe, it, expect, vi } from 'vitest';
import { createMcpDirectExecutor, withinMcpDeadline } from './delivery';
import { projectExecution, projectHumanOutcome, type ExecutionRecord } from '@drasil/application';

const context = {
  guildId: 'guild',
  requestId: 'execution',
  source: 'mcp',
  actor: { kind: 'user' as const, userId: 'actor' },
};
describe('MCP direct delivery', () => {
  it('runs attention directly and preserves each result without actor provenance', async () => {
    const acknowledge = vi.fn(async (_context, { itemId }) => ({
      kind: 'outcome',
      outcome: { actor: { id: 'actor', surface: 'mcp' }, itemId, status: 'acknowledged' },
    }));
    const executor = createMcpDirectExecutor({
      attention: { acknowledge },
      reportReview: {},
    } as never);
    const result = await executor.execute(
      context,
      { kind: 'acknowledge_attention', itemIds: ['one', 'two'] },
      { kind: 'none' }
    );
    expect(result).toMatchObject({
      kind: 'attention_batch',
      items: [
        { itemId: 'one', state: 'completed' },
        { itemId: 'two', state: 'completed' },
      ],
    });
    expect(acknowledge).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('surface');
  });
  it('calls existing report close and never invokes the effectful open wrapper', async () => {
    const close = vi.fn(async () => ({
      kind: 'outcome',
      outcome: { status: 'closed', queueCleanupStatus: 'failed' },
    }));
    const openCase = vi.fn();
    const executor = createMcpDirectExecutor({ reportReview: { close, openCase } } as never);
    expect(
      await executor.execute(
        context,
        { kind: 'close_submitted_report', reportId: 'report', action: 'dismiss_no_action' },
        { kind: 'none' }
      )
    ).toMatchObject({ status: 'closed', queueCleanupStatus: 'failed' });
    await expect(
      executor.execute(
        context,
        { kind: 'open_submitted_report_case', reportId: 'report' },
        { kind: 'none' }
      )
    ).rejects.toThrow('unsupported_direct_workflow');
    expect(openCase).not.toHaveBeenCalled();
  });
  it('requires approved setup execution and forwards its exact precondition', async () => {
    const executor = createMcpDirectExecutor({} as never);
    const command = { kind: 'update_setup' as const, changes: { adminChannelId: '123' } };
    await expect(executor.execute(context, command, { kind: 'none' })).rejects.toThrow();
    const execute = vi.fn(async () => ({ kind: 'update_setup', status: 'updated' }));
    const precondition = { kind: 'setup', approvedState: { guild_id: 'guild' } } as const;
    const composed = createMcpDirectExecutor({} as never, { execute } as never);
    await composed.execute(context, command, precondition as never);
    expect(execute).toHaveBeenCalledWith(context, command, precondition);
  });
  it('bounds response waiting at five seconds with an injected timer', async () => {
    const clock = {
      after: vi.fn((_ms: number, fn: () => void) => {
        fn();
        return () => {};
      }),
    };
    expect(
      await withinMcpDeadline(new Promise(() => {}), () => ({ state: 'uncertain' }), clock)
    ).toEqual({ state: 'uncertain' });
    expect(clock.after.mock.calls[0][0]).toBe(5000);
  });
});
it('returns an owned queued receipt within five seconds and stops polling after the deadline', async () => {
  const { waitForMcpReceipt } = await import('./delivery');
  vi.useFakeTimers();
  try {
    const actor = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: ['drasil:read'] as const,
    };
    const queued = { state: 'queued' as const, executionId: 'execution', retryAfterMs: 2000 };
    const status = vi.fn(async () => queued);
    const pending = waitForMcpReceipt({ status }, actor, queued);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual(queued);
    expect(status).toHaveBeenCalledWith(actor, 'execution');
    const count = status.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(status).toHaveBeenCalledTimes(count);
  } finally {
    vi.useRealTimers();
  }
});
it('returns a completed own receipt early and bounds an unavailable status read', async () => {
  const { waitForMcpReceipt } = await import('./delivery');
  vi.useFakeTimers();
  try {
    const actor = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: ['drasil:read'] as const,
    };
    const queued = { state: 'queued' as const, executionId: 'execution' };
    const done = { state: 'partial' as const, executionId: 'execution' };
    const work = waitForMcpReceipt({ status: async () => done }, actor, queued);
    await vi.advanceTimersByTimeAsync(250);
    expect(await work).toEqual(done);
    const stalled = waitForMcpReceipt({ status: async () => new Promise(() => {}) }, actor, queued);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await stalled).toEqual(queued);
  } finally {
    vi.useRealTimers();
  }
});

it.each(['drasil:moderate', 'drasil:configure'] as const)(
  'preserves the accepted receipt immediately without optional polling for %s-only connections',
  async (scope) => {
    const { waitForMcpReceipt } = await import('./delivery');
    const actor = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: [scope],
    };
    const queued = {
      state: 'queued' as const,
      executionId: 'execution',
      operation: 'ban_user' as const,
      guildId: 'guild',
      retryAfterMs: 2000,
    };
    const status = vi.fn(async () => ({ state: 'denied' as const, code: 'scope_denied' }));
    expect(await waitForMcpReceipt({ status }, actor, queued)).toBe(queued);
    expect(status).not.toHaveBeenCalled();
  }
);

describe.each(['queued', 'running'] as const)(
  'optional polling after an owned %s receipt',
  (state) => {
    it.each(
      (['rate_limited', 'permission_denied', 'invalid_grant'] as const).flatMap((code) =>
        [undefined, 'other-execution'].map((executionId) => ({ code, executionId }))
      )
    )('preserves the receipt and stops on $code with executionId=$executionId', async (denial) => {
      const { waitForMcpReceipt } = await import('./delivery');
      vi.useFakeTimers();
      try {
        const actor = {
          userId: 'actor',
          clientId: 'client',
          connectionId: 'connection',
          grantVersion: 1,
          scopes: ['drasil:read'] as const,
        };
        const initial = { state: 'queued' as const, executionId: 'execution' };
        const owned = { state, executionId: 'execution', requestId: 'request', retryAfterMs: 2000 };
        const status = vi
          .fn()
          .mockResolvedValueOnce(owned)
          .mockResolvedValue({ state: 'denied', ...denial });
        const pending = waitForMcpReceipt({ status }, actor, initial);
        await vi.advanceTimersByTimeAsync(500);
        expect(await pending).toBe(owned);
        expect(status).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5000);
        expect(status).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  }
);

it('returns a terminal worker denial bound to the accepted execution', async () => {
  const { waitForMcpReceipt } = await import('./delivery');
  vi.useFakeTimers();
  try {
    const actor = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: ['drasil:read'] as const,
    };
    const command = { kind: 'clear_moderation_queue' as const };
    const execution: ExecutionRecord = {
      ...actor,
      executionId: 'execution',
      confirmationId: 'confirmation',
      confirmationMethod: 'client_confirmation',
      workflowId: command.kind,
      guildId: 'guild',
      command,
      commandDigest: 'digest',
      authorizedDelivery: { kind: 'queued', command, commandDigest: 'digest' },
      preconditions: { kind: 'none' },
      stateFingerprint: 'fingerprint',
      summary: 'Clear moderation queue',
      previewExpiresAt: null,
      queueRequestId: 'request',
      createdAt: new Date(),
      startedAt: null,
      completedAt: new Date(),
      outcome: {
        kind: 'delegated_terminal',
        result: projectHumanOutcome(command, {
          action_type: 'delegated_admission',
          state: 'denied',
          code: 'permission_denied',
        }),
      },
    };
    const denied = projectExecution(execution);
    expect(denied).toMatchObject({
      state: 'denied',
      executionId: 'execution',
      requestId: 'request',
      code: 'permission_denied',
    });
    const status = vi.fn(async () => denied);
    const pending = waitForMcpReceipt({ status }, actor, {
      state: 'running',
      executionId: 'execution',
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toBe(denied);
    await vi.advanceTimersByTimeAsync(5000);
    expect(status).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
