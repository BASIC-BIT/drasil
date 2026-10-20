import { beforeEach, expect, test, vi } from 'vitest';
import { queueModerationQueueOperation } from './moderationQueueOperationActionQueue';
import { queueModerationActionRequest } from './moderationActionRequestQueue';
import { type QueuedOperationCommand, decodeQueuedAction } from '@drasil/application';
vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('./moderationActionRequestQueue', () => ({
  queueModerationActionRequest: vi.fn(async () => 'queued'),
}));
const queue = vi.mocked(queueModerationActionRequest);
const commands: QueuedOperationCommand[] = [
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
];
beforeEach(() => vi.clearAllMocks());
test.each(commands)(
  'queues shared typed operation $kind preserving metadata and idempotency',
  async (command) => {
    expect(
      await queueModerationQueueOperation({ guildId: 'guild', actorId: 'admin', command })
    ).toBe('queued');
    const input = queue.mock.calls[0][0];
    expect(input.idempotencyKey).toMatch(new RegExp(`^web:operation:${command.kind}:guild:`));
    expect(input.actorSurface).toBe('web');
    expect(input.targetUserId).toBeNull();
    expect(
      decodeQueuedAction({
        id: 'request',
        server_id: input.serverId,
        action_type: input.actionType,
        actor_id: input.actorId,
        actor_surface: input.actorSurface,
        target_user_id: input.targetUserId,
        metadata: input.metadata,
      }).command
    ).toEqual(command);
  }
);
test('rejects injected actor context at typed submission boundary', async () => {
  await expect(
    queueModerationQueueOperation({
      guildId: 'guild',
      actorId: 'admin',
      command: { kind: 'sync_moderation_queue', actor: 'forged' } as never,
    })
  ).rejects.toThrow();
  expect(queue).not.toHaveBeenCalled();
});
