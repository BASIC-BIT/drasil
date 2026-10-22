import { describe, it, expect, vi } from 'vitest';
import { createApprovalTools } from './tools/approvals';

describe('MCP exact approval boundary', () => {
  it('accepts only the saved confirmation ID and chooses the method internally', async () => {
    const service = {
      confirm: vi.fn(async () => ({ state: 'queued', executionId: 'execution' })),
      cancel: vi.fn(),
      prepareIntent: vi.fn(),
    };
    const tools = createApprovalTools(service as never);
    const principal = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: [],
    };
    expect(
      await tools
        .find((tool) => tool.toolName === 'confirm_action')!
        .handler(principal, { confirmationId: 'saved' })
    ).toEqual({
      state: 'queued',
      executionId: 'execution',
    });
    expect(service.confirm).toHaveBeenCalledWith(principal, 'saved', 'client_confirmation');
    for (const key of ['approved', 'method', 'command', 'actor', 'grantVersion']) {
      await expect(
        tools
          .find((tool) => tool.toolName === 'confirm_action')!
          .handler(principal, { confirmationId: 'saved', [key]: true })
      ).rejects.toThrow();
    }
    expect(service.confirm).toHaveBeenCalledTimes(1);
  });
  it('cancels only a saved intent ID', async () => {
    const service = { cancel: vi.fn(async () => ({ state: 'denied', code: 'cancelled' })) };
    const tools = createApprovalTools(service as never);
    expect(
      await tools
        .find((tool) => tool.toolName === 'cancel_action')!
        .handler({} as never, { confirmationId: 'saved' })
    ).toEqual({
      state: 'denied',
      code: 'cancelled',
    });
    await expect(
      tools
        .find((tool) => tool.toolName === 'cancel_action')!
        .handler({} as never, { confirmationId: 'saved', method: 'not_required' })
    ).rejects.toThrow();
  });
});
