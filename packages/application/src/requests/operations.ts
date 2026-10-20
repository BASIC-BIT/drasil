import {
  queuedOperationCommandSchema,
  isQueuedOperationKind,
  type QueuedOperationCommand,
} from '../operations/commands';
import type { ActionContext } from '../context';
import type { QueuedRow } from './decode';
import type { EnqueueInput } from './receipt';
export function encodeOperationAction(
  context: ActionContext,
  command: QueuedOperationCommand
): EnqueueInput {
  if (context.actor.kind !== 'user') throw new Error('Operations require a staff actor.');
  return {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: null,
    idempotencyKey: `${context.source}:operation:${command.kind}:${context.guildId}:${context.requestId}`,
    metadata: {
      operation_action: command.kind,
      requested_surface: context.source,
      ...('days' in command ? { days: command.days } : {}),
      ...('execute' in command ? { execute: command.execute } : {}),
      ...('limit' in command ? { limit: command.limit } : {}),
      ...('reason' in command && command.reason !== null ? { reason: command.reason } : {}),
      ...('roleId' in command ? { role_id: command.roleId } : {}),
      ...('unsyncAllowedChannels' in command
        ? { unsync_allowed_channels: command.unsyncAllowedChannels }
        : {}),
      ...('userId' in command && command.userId ? { user_id: command.userId } : {}),
    },
  };
}
export function decodeOperationCommand(row: QueuedRow): QueuedOperationCommand | null {
  if (!isQueuedOperationKind(row.action_type)) return null;
  const metadata = row.metadata ?? {};
  const base = { kind: row.action_type };
  switch (row.action_type) {
    case 'close_resolved_case_threads':
      return queuedOperationCommandSchema.parse({
        ...base,
        intent: 'administrator_operation',
        days: metadata.days ?? 30,
        limit: metadata.limit ?? 100,
        execute: metadata.execute === true,
        userId: metadata.user_id ?? null,
      });
    case 'intake_role_members':
      return queuedOperationCommandSchema.parse({
        ...base,
        roleId: metadata.role_id,
        limit: metadata.limit ?? 250,
        execute: metadata.execute === true,
        reason: metadata.reason ?? null,
      });
    case 'apply_case_role_lockdown':
      return queuedOperationCommandSchema.parse({
        ...base,
        unsyncAllowedChannels: metadata.unsync_allowed_channels === true,
      });
    default:
      return queuedOperationCommandSchema.parse(base);
  }
}
