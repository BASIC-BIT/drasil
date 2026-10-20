import type { ActionContext } from '../context';
import {
  queuedReportCommandSchema,
  isQueuedReportKind,
  type QueuedReportCommand,
} from '../reports/commands';
import type { QueuedRow } from './decode';
import type { EnqueueInput } from './receipt';
export function decodeReportCommand(row: QueuedRow): QueuedReportCommand | null {
  if (!isQueuedReportKind(row.action_type)) return null;
  const metadata = row.metadata ?? {};
  switch (row.action_type) {
    case 'submit_user_report':
      return queuedReportCommandSchema.parse({
        kind: row.action_type,
        targetUserId: row.target_user_id,
        targetLabel:
          typeof metadata.target_label === 'string' ? metadata.target_label : row.target_user_id,
        reason: typeof metadata.reason === 'string' ? metadata.reason.trim() || null : null,
      });
    case 'start_report_intake':
      return queuedReportCommandSchema.parse({
        kind: row.action_type,
        channelId: metadata.channel_id,
      });
    case 'close_report_intake':
      return queuedReportCommandSchema.parse({
        kind: row.action_type,
        intakeId: row.report_intake_id,
      });
  }
}
export function encodeReportAction(
  context: ActionContext,
  command: QueuedReportCommand
): EnqueueInput {
  if (context.actor.kind !== 'user') throw new Error('Report requires a user actor.');
  const binding =
    command.kind === 'submit_user_report'
      ? command.targetUserId
      : command.kind === 'start_report_intake'
        ? context.actor.userId
        : command.intakeId;
  return {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: command.kind === 'submit_user_report' ? command.targetUserId : null,
    ...(command.kind === 'close_report_intake' ? { reportIntakeId: command.intakeId } : {}),
    idempotencyKey: `web:report:${command.kind}:${context.guildId}:${binding}:${context.requestId}`,
    metadata: {
      report_action: command.kind,
      requested_surface: context.source,
      ...(command.kind === 'submit_user_report'
        ? { reason: command.reason, target_label: command.targetLabel }
        : command.kind === 'start_report_intake'
          ? { channel_id: command.channelId }
          : {}),
    },
  };
}
