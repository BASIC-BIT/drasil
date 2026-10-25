import { expect, it } from 'vitest';
import { adaptInboxStateAction } from './workspaceActionTypes';
it.each(['queued', 'processing', 'completed', 'failed'] as const)(
  'preserves actual %s receipt identity and status',
  async (status) => {
    const result = await adaptInboxStateAction(async () => ({
      requestId: 'actual-request',
      status,
      message: 'Actual result',
    }))(new FormData());
    expect(result).toEqual({ kind: 'request', receipt: { id: 'actual-request', status } });
  }
);
it('keeps a prequeue failure without manufacturing a request', async () => {
  expect(
    await adaptInboxStateAction(async () => ({
      requestId: null,
      status: 'failed',
      message: 'Denied',
    }))(new FormData())
  ).toEqual({ kind: 'failed', message: 'Denied' });
});
