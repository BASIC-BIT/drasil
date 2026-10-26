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
    case 'submit_message_report':
    case 'confirm_intake_candidate':
    case 'reject_intake_candidates':
      return queuedReportCommandSchema.parse({
        ...(typeof metadata.report_command === 'object' ? metadata.report_command : {}),
        kind: row.action_type,
      });
    case 'submit_user_report':
      return queuedReportCommandSchema.parse({
        kind: row.action_type,
        targetUserId: row.target_user_id,
        targetLabel:
          typeof metadata.target_label === 'string' ? metadata.target_label : row.target_user_id,
        reason:
          typeof metadata.reason === 'string'
            ? row.actor_surface === 'mcp'
              ? metadata.reason
              : metadata.reason.trim() || null
            : null,
        ...(row.actor_surface === 'mcp' && typeof metadata.pass_undefined_reason === 'boolean'
          ? { passUndefinedReason: metadata.pass_undefined_reason }
          : {}),
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
  if (
    command.kind === 'submit_message_report' ||
    command.kind === 'confirm_intake_candidate' ||
    command.kind === 'reject_intake_candidates'
  ) {
    const { kind, ...fields } = command;
    return {
      actionType: kind,
      actorId: context.actor.userId,
      actorSurface: context.source,
      serverId: context.guildId,
      targetUserId: 'targetUserId' in command ? command.targetUserId : null,
      ...('intakeId' in command ? { reportIntakeId: command.intakeId } : {}),
      idempotencyKey: `${context.source}:report:${kind}:${context.guildId}:${context.requestId}`,
      metadata: { requested_surface: context.source, report_command: fields },
    };
  }
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
        ? {
            reason: command.reason,
            target_label: command.targetLabel,
            ...(context.source === 'mcp' && command.passUndefinedReason !== undefined
              ? { pass_undefined_reason: command.passUndefinedReason }
              : {}),
          }
        : command.kind === 'start_report_intake'
          ? { channel_id: command.channelId }
          : {}),
    },
  };
}
