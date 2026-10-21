import { describe, it, expect, vi } from 'vitest';
import { createMcpIntentHandlers } from './intents';

describe('MCP exact approval boundary', () => {
  it('accepts only the saved confirmation ID and chooses the method internally', async () => {
    const service = {
      acceptIntent: vi.fn(async () => ({ executionId: 'execution' })),
      cancelIntent: vi.fn(),
      prepareIntent: vi.fn(),
    };
    const handlers = createMcpIntentHandlers(service as never);
    const principal = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: [],
    };
    expect(await handlers.confirmAction(principal, { confirmationId: 'saved' })).toEqual({
      executionId: 'execution',
    });
    expect(service.acceptIntent).toHaveBeenCalledWith(principal, 'saved', 'client_confirmation');
    for (const key of ['approved', 'method', 'command', 'actor', 'grantVersion']) {
      await expect(
        handlers.confirmAction(principal, { confirmationId: 'saved', [key]: true })
      ).rejects.toThrow();
    }
    expect(service.acceptIntent).toHaveBeenCalledTimes(1);
  });
  it('cancels only a saved intent ID', async () => {
    const service = { cancelIntent: vi.fn(async () => ({ state: 'cancelled' })) };
    const handlers = createMcpIntentHandlers(service as never);
    expect(await handlers.cancelAction({} as never, { confirmationId: 'saved' })).toEqual({
      state: 'cancelled',
    });
    await expect(
      handlers.cancelAction({} as never, { confirmationId: 'saved', method: 'not_required' })
    ).rejects.toThrow();
  });
});
