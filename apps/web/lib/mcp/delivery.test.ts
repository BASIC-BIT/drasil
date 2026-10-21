import { describe, it, expect, vi } from 'vitest';
import { createMcpDirectExecutor, withinMcpDeadline } from './delivery';

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
