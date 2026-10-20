import type { ActionContext } from '../context';
import { queuedCommandSchema, type QueuedCommand } from './commands';
import type { EnqueueInput } from './receipt';

export function encodeQueuedAction(context: ActionContext, input: QueuedCommand): EnqueueInput {
  const command = queuedCommandSchema.parse(input);
  if (context.actor.kind !== 'user')
    throw new Error('Report case submission requires a user actor.');
  return {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    detectionEventId: command.detectionEventId,
    targetUserId: command.targetUserId,
    reportIntakeId: command.reportId,
    idempotencyKey: `${context.source}:report-open-case:${context.guildId}:${command.reportId ?? 'no-report'}:${command.detectionEventId}`,
    metadata: { requested_surface: context.source, report_intake_id: command.reportId },
  };
}
