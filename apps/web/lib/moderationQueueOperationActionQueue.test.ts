import { beforeEach, expect, test, vi } from 'vitest';
import { queueModerationQueueOperation } from './moderationQueueOperationActionQueue';
import { type QueuedOperationCommand, decodeQueuedAction } from '@drasil/application';
vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
const mocks = vi.hoisted(() => ({
  query: vi.fn().mockResolvedValue({ rows: [{ id: 'request', status: 'queued' }] }),
}));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => ({ query: mocks.query }) }));
const queue = mocks.query;
const context = {
  guildId: 'guild',
  requestId: 'submission-1',
  source: 'web',
  actor: { kind: 'user' as const, userId: 'admin' },
};
const commands = [
  { kind: 'sync_moderation_queue' },
  { kind: 'clear_moderation_queue' },
  {
    kind: 'close_resolved_case_threads',
    intent: 'administrator_operation',
    execute: false,
    days: 42,
    limit: 51,
    userId: null,
  },
  { kind: 'audit_case_role_lockdown' },
  { kind: 'apply_case_role_lockdown', unsyncAllowedChannels: false },
  { kind: 'intake_role_members', execute: true, limit: 12, roleId: 'role', reason: 'reason' },
] satisfies QueuedOperationCommand[];
beforeEach(() => vi.clearAllMocks());
test.each(commands)(
  'queues shared typed operation $kind preserving metadata and idempotency',
  async (command) => {
    expect(await queueModerationQueueOperation({ context, command })).toMatchObject({
      id: 'request',
      status: 'queued',
    });
    const values = queue.mock.calls[0][1];
    expect(values[9]).toMatch(new RegExp(`^web:operation:${command.kind}:guild:`));
    expect(values[2]).toBe('admin');
    expect(values[3]).toBe('web');
    expect(values[4]).toBeNull();
    expect(
      decodeQueuedAction({
        id: 'request',
        server_id: values[0],
        action_type: values[1],
        actor_id: values[2],
        actor_surface: values[3],
        target_user_id: values[4],
        metadata: JSON.parse(values[10]),
      }).command
    ).toEqual(command);
  }
);
test('rejects injected actor context at typed submission boundary', async () => {
  await expect(
    queueModerationQueueOperation({
      context,
      command: { kind: 'sync_moderation_queue', actor: 'forged' } as never,
    })
  ).rejects.toThrow();
  expect(queue).not.toHaveBeenCalled();
});
