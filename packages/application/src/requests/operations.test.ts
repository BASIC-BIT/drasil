import { encodeQueuedAction } from './encode';
import { decodeQueuedAction } from './decode';
import type { QueuedOperationCommand } from '../operations/commands';
const context = {
  guildId: 'guild',
  requestId: 'nonce',
  source: 'web',
  actor: { kind: 'user', userId: 'admin' },
} as const;
const commands: QueuedOperationCommand[] = [
  { kind: 'sync_moderation_queue' },
  { kind: 'clear_moderation_queue' },
  {
    kind: 'close_resolved_case_threads',
    intent: 'administrator_operation',
    days: 30,
    limit: 100,
    execute: false,
    userId: null,
  },
  { kind: 'audit_case_role_lockdown' },
  { kind: 'apply_case_role_lockdown', unsyncAllowedChannels: false },
  { kind: 'intake_role_members', roleId: 'role', limit: 250, reason: 'reason', execute: true },
];
test.each(commands)(
  'round trips operation $kind with null target and shipped metadata',
  (command) => {
    const encoded = encodeQueuedAction(context, command);
    expect(encoded.idempotencyKey).toBe(`web:operation:${command.kind}:guild:nonce`);
    expect(encoded.targetUserId).toBeNull();
    expect(encoded.metadata.operation_action).toBe(command.kind);
    const decoded = decodeQueuedAction({
      id: 'request',
      server_id: 'guild',
      actor_id: 'admin',
      actor_surface: 'web',
      action_type: encoded.actionType,
      target_user_id: null,
      metadata: encoded.metadata,
    });
    expect(decoded.command).toEqual(command);
    expect(decoded.context).toEqual({ ...context, requestId: 'request' });
  }
);
test('decodes shipped operation defaults without inventing proof fields', () => {
  expect(
    decodeQueuedAction({
      id: 'request',
      server_id: 'guild',
      actor_id: 'admin',
      actor_surface: 'web',
      action_type: 'apply_case_role_lockdown',
      target_user_id: null,
      metadata: {},
    }).command
  ).toEqual({ kind: 'apply_case_role_lockdown', unsyncAllowedChannels: false });
});
test('legacy sweep rows keep administrator provenance; explicit guild audits retain their intent', () => {
  const row = {
    id: 'request',
    server_id: 'guild',
    actor_id: 'admin',
    actor_surface: 'discord_interaction',
    action_type: 'close_resolved_case_threads',
    target_user_id: null,
    metadata: { intent: 'guild_audit' },
  };
  expect(decodeQueuedAction(row).command).toEqual({
    kind: 'close_resolved_case_threads',
    intent: 'administrator_operation',
    execute: false,
    days: 30,
    limit: 100,
    userId: null,
  });
  const command = {
    kind: 'close_resolved_case_threads',
    intent: 'guild_audit',
    execute: false,
    days: 30,
    limit: 100,
    userId: null,
  } as const;
  const encoded = encodeQueuedAction({ ...context, source: 'mcp' }, command);
  expect(
    decodeQueuedAction({ ...row, actor_surface: 'mcp', metadata: encoded.metadata }).command
  ).toEqual(command);
});
