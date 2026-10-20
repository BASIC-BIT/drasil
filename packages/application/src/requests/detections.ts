import type { QueuedRow } from './decode';
import { queuedCommandSchema, type QueuedCommand } from './commands';
import type { ActionContext } from '../context';
import type { QueuedDetectionCommand } from '../detections/commands';
import type { EnqueueInput } from './receipt';
const inboxAction = {
  dismiss_observed_detection: 'dismiss_no_action',
  mark_observed_detection_false_positive: 'mark_false_positive',
  undo_observed_detection_action: 'undo',
  kick_observed_detection: 'kick_user',
  ban_observed_detection: 'ban_user',
} as const;
export function encodeDetectionAction(
  context: ActionContext,
  command: QueuedDetectionCommand
): EnqueueInput {
  if (context.actor.kind !== 'user') throw new Error('Detection submission requires a user actor.');
  const base = {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: command.targetUserId,
    detectionEventId: command.detectionEventId,
  };
  if (
    command.kind === 'ignore_detection_accounting' ||
    command.kind === 'restore_detection_accounting'
  ) {
    const action =
      command.kind === 'ignore_detection_accounting' ? 'ignore_detection' : 'restore_detection';
    return {
      ...base,
      idempotencyKey: `web:detection-accounting:${action}:${context.guildId}:${command.detectionEventId}`,
      metadata: { reason: command.reason, requested_surface: context.source, web_action: action },
    };
  }
  if (
    command.kind === 'ban_observed_detection' &&
    (context.source === 'discord_interaction' || context.source === 'web_report')
  )
    return {
      ...base,
      reportIntakeId: command.subject.kind === 'report' ? command.subject.reportId : null,
      idempotencyKey: `observed-ban:${context.guildId}:${command.detectionEventId}`,
      metadata: { reason: command.reason, requested_action: 'ban_user' },
    };
  return {
    ...base,
    ...(command.kind === 'ban_observed_detection'
      ? { reportIntakeId: command.subject.kind === 'report' ? command.subject.reportId : null }
      : {}),
    idempotencyKey: `web:observed-action:${inboxAction[command.kind]}:${context.guildId}:${command.detectionEventId}`,
    metadata: {
      inbox_action:
        command.kind === 'undo_observed_detection_action'
          ? 'undo_observed_action'
          : inboxAction[command.kind],
      ...(command.kind === 'undo_observed_detection_action'
        ? {}
        : { reason: 'reason' in command ? command.reason : null }),
      requested_surface: context.source,
    },
  };
}

export function decodeDetectionCommand(
  parsed: QueuedRow,
  reason: string | null
): QueuedCommand | null {
  const target = { kind: parsed.action_type, targetUserId: parsed.target_user_id };
  let command: QueuedCommand;
  switch (parsed.action_type) {
    case 'ban_observed_detection':
      command = queuedCommandSchema.parse({
        ...target,
        detectionEventId: parsed.detection_event_id,
        reason,
        subject: parsed.report_intake_id
          ? { kind: 'report', reportId: parsed.report_intake_id }
          : { kind: 'observed' },
      });
      break;
    case 'kick_observed_detection':
    case 'ignore_detection_accounting':
    case 'restore_detection_accounting':
      command = queuedCommandSchema.parse({
        ...target,
        detectionEventId: parsed.detection_event_id,
        reason,
      });
      break;
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
    case 'undo_observed_detection_action':
      command = queuedCommandSchema.parse({
        ...target,
        detectionEventId: parsed.detection_event_id,
      });
      break;

    default:
      return null;
  }
  return command;
}
