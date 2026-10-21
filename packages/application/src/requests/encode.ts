import type { DelegatedDeliveryBinding } from '../delegation/types';
import { isQueuedSetupCommand } from '../setup/commands';
import { encodeSetupAction } from './setup';
import { isQueuedReportCommand } from '../reports/commands';
import { encodeReportAction } from './reports';
import { encodeOperationAction } from './operations';
import { isQueuedOperationCommand } from '../operations/commands';
import { encodeMessageCleanupAction } from './messageCleanup';
import { encodeCaptchaAction } from './captcha';
import { encodeDetectionAction } from './detections';
import type { ActionContext } from '../context';
import { queuedCommandSchema, isQueuedCaptchaCommand, type QueuedCommand } from './commands';
import type { EnqueueInput } from './receipt';
const caseAction = {
  verify_case_user: 'verify_user',
  close_case_no_action: 'close_no_action',
  kick_case_user: 'kick_user',
  ban_case_user: 'ban_user',
  ban_case_user_by_id: 'ban_by_id',
  repair_active_case: 'repair_thread',
  reopen_case: 'reopen_case',
  refresh_case_notification: 'refresh_notification',
  sync_existing_ban: 'sync_existing_ban',
} as const;
export function encodeQueuedAction(
  context: ActionContext,
  input: QueuedCommand,
  binding?: DelegatedDeliveryBinding
): EnqueueInput {
  const encoded = encodeAction(context, input);
  return binding
    ? { ...encoded, metadata: { ...encoded.metadata, delegation: { ...binding } } }
    : encoded;
}
function encodeAction(context: ActionContext, input: QueuedCommand): EnqueueInput {
  const command = queuedCommandSchema.parse(input);
  if (isQueuedSetupCommand(command)) return encodeSetupAction(context, command);
  if (isQueuedReportCommand(command)) return encodeReportAction(context, command);
  if (isQueuedOperationCommand(command)) return encodeOperationAction(context, command);
  if (isQueuedCaptchaCommand(command)) return encodeCaptchaAction(context, command);
  if (context.actor.kind !== 'user') throw new Error('Case submission requires a user actor.');
  const base = {
    actionType: command.kind,
    actorId: context.actor.userId,
    actorSurface: context.source,
    serverId: context.guildId,
    targetUserId: command.targetUserId,
  };
  switch (command.kind) {
    case 'preview_case_message_deletion':
    case 'execute_case_message_deletion':
    case 'ban_case_user_with_message_cleanup':
      return encodeMessageCleanupAction(context, command);
    case 'preview_account_quarantine':
    case 'quarantine_compromised_account':
      return {
        ...base,
        verificationEventId: command.caseId,
        idempotencyKey: `${context.source}:case-action:quarantine_compromised_account:${context.guildId}:${command.caseId}:${command.kind === 'preview_account_quarantine' ? `preview:${context.requestId}` : `execute:${command.previewReference.requestId}`}`,
        metadata: {
          case_action: 'quarantine_compromised_account',
          quarantine_phase: command.kind === 'preview_account_quarantine' ? 'preview' : 'execute',
          requested_surface: context.source,
          ...(command.kind === 'quarantine_compromised_account'
            ? { reason: command.reason, preview_request_id: command.previewReference.requestId }
            : {}),
        },
      };
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
    case 'undo_observed_detection_action':
    case 'kick_observed_detection':
    case 'ban_observed_detection':
    case 'ignore_detection_accounting':
    case 'restore_detection_accounting':
      return encodeDetectionAction(context, command);
    case 'open_case_from_observed_detection':
      if (command.origin?.kind === 'observed_alert') {
        if (command.reportId !== null)
          throw new Error('Observed-alert origin cannot bind a report.');
        return {
          ...base,
          detectionEventId: command.detectionEventId,
          idempotencyKey: `web:observed-action:open_case:${context.guildId}:${command.detectionEventId}`,
          metadata: {
            inbox_action: 'open_case',
            reason: command.origin.reason,
            requested_surface: context.source,
          },
        };
      }
      return {
        ...base,
        detectionEventId: command.detectionEventId,
        reportIntakeId: command.reportId,
        idempotencyKey: `${context.source}:report-open-case:${context.guildId}:${command.reportId ?? 'no-report'}:${command.detectionEventId}`,
        metadata: { requested_surface: context.source, report_intake_id: command.reportId },
      };
    case 'open_admin_case':
      return {
        ...base,
        detectionEventId: command.detectionEventId,
        idempotencyKey: `${context.source}:member-open-case:${context.guildId}:${command.targetUserId}:${context.requestId}`,
        metadata: {
          reason: command.reason,
          requested_surface: context.source,
          ...(command.selectedMessage
            ? {
                source: 'message_context_case',
                source_channel_id: command.selectedMessage.channelId,
                source_message_id: command.selectedMessage.messageId,
              }
            : {}),
          web_action: command.kind,
        },
      };
    case 'manual_flag_user':
      return {
        ...base,
        idempotencyKey: `${context.source}:member-manual-flag:${context.guildId}:${command.targetUserId}:${context.requestId}`,
        metadata: {
          reason: command.reason,
          requested_surface: context.source,
          web_action: command.kind,
        },
      };
    default:
      return {
        ...base,
        verificationEventId: command.caseId,
        ...('detectionEventId' in command ? { detectionEventId: command.detectionEventId } : {}),
        idempotencyKey: `${context.source}:case-action:${command.kind === 'repair_active_case' ? command.mode : caseAction[command.kind]}:${context.guildId}:${command.caseId}`,
        metadata: {
          case_action:
            command.kind === 'repair_active_case' ? command.mode : caseAction[command.kind],
          ...('reason' in command && command.reason ? { reason: command.reason } : {}),
          requested_surface: context.source,
        },
      };
  }
}
