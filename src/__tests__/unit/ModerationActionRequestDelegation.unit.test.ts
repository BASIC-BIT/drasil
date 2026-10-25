import { prepareQueuedRequest } from '../../application/requestRuntime';
it('checks delegated admission before issuing confirmation evidence', async () => {
  const recordVerified = jest.fn();
  const execute = jest.fn();
  const request = {
    id: 'request',
    server_id: 'guild',
    actor_id: 'actor',
    actor_surface: 'mcp',
    target_user_id: null,
    action_type: 'clear_moderation_queue',
    metadata: {},
  };
  const prepared = await prepareQueuedRequest({
    request: request as never,
    runtime: {
      caseConfirmations: { recordVerified },
      operations: { execute },
      delegation: {
        authorizeDelegatedRequest: async () => ({ kind: 'denied', code: 'invalid_grant' }),
      },
    } as never,
    analytics: {} as never,
  });
  const result = await prepared.execute();
  expect(result).toMatchObject({ state: 'denied' });
  expect(recordVerified).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
it('preserves a fresh domain denial as denied after admission', async () => {
  const request = {
    id: 'request',
    server_id: 'guild',
    actor_id: 'actor',
    actor_surface: 'mcp',
    target_user_id: null,
    action_type: 'clear_moderation_queue',
    metadata: {},
  };
  const execute = jest.fn(async () => ({ kind: 'denied', code: 'permission_denied' }));
  const prepared = await prepareQueuedRequest({
    request: request as never,
    runtime: {
      caseConfirmations: { recordVerified: jest.fn() },
      operations: { execute },
      delegation: {
        authorizeDelegatedRequest: async () => ({ kind: 'new_execution', execution: {} }),
      },
    } as never,
    analytics: {} as never,
  });
  expect(await prepared.execute()).toMatchObject({ state: 'denied', code: 'permission_denied' });
});

import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
it.each(['processing', 'completed'])(
  'publishes only durable %s receipt after completion fencing',
  async (status) => {
    const request = {
      id: 'request',
      server_id: 'guild',
      actor_id: 'actor',
      actor_surface: 'mcp',
      target_user_id: null,
      action_type: 'clear_moderation_queue',
      metadata: {},
    };
    const complete = jest.fn();
    const runtime = {
      caseConfirmations: { recordVerified: jest.fn() },
      operations: {
        execute: async () => ({
          kind: 'outcome',
          outcome: { kind: 'clear_moderation_queue', removedCount: 2 },
        }),
      },
      delegation: {
        authorizeDelegatedRequest: async () => ({
          kind: 'new_execution',
          execution: { executionId: 'execution' },
        }),
        complete,
      },
    };
    const durable = { action_type: 'clear_moderation_queue', removed_count: 3 };
    const repository = {
      claimReportBanReconciliation: async () => null,
      claimNext: jest.fn().mockResolvedValueOnce(request).mockResolvedValue(null),
      complete: async () => ({ ...request, status, result: durable }),
      fail: jest.fn(),
    };
    const service = new ModerationActionRequestService(
      repository as never,
      runtime as never,
      {} as never
    );
    await service.processPendingRequests(1);
    if (status === 'processing') expect(complete).not.toHaveBeenCalled();
    else expect(complete).toHaveBeenCalledWith({ executionId: 'execution' }, durable);
  }
);
