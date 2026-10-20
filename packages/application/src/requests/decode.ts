import { isQueuedOperationKind } from '../operations/commands';
import { decodeOperationCommand } from './operations';
import { decodeMessageCleanupCommand } from './messageCleanup';
import { decodeCaptchaCommand } from './captcha';
import { decodeDetectionCommand } from './detections';
import { z } from 'zod';
import type { ActionContext } from '../context';
import { queuedCommandSchema, type QueuedCommand } from './commands';
const id = z.string().min(1);
const queuedRowSchema = z
  .object({
    id,
    server_id: id,
    action_type: id,
    actor_id: id,
    actor_surface: id,
    target_user_id: id.nullable(),
    detection_event_id: id.nullable().optional(),
    report_intake_id: id.nullable().optional(),
    verification_event_id: id.nullable().optional(),
    message_deletion_job_id: id.nullable().optional(),
    metadata: z.record(z.unknown()).nullable().optional(),
  })
  .superRefine((row, ctx) => {
    if (row.target_user_id === null && !isQueuedOperationKind(row.action_type))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['target_user_id'],
        message: 'A target user is required for this action.',
      });
  });
export type QueuedRow = z.infer<typeof queuedRowSchema>;
export interface DecodedQueuedAction {
  readonly context: ActionContext;
  readonly command: QueuedCommand;
}
export function decodeQueuedAction(row: unknown): DecodedQueuedAction {
  const parsed = queuedRowSchema.parse(row);
  const metadata = parsed.metadata ?? {};
  const reason = typeof metadata.reason === 'string' ? metadata.reason : null;
  const target = { kind: parsed.action_type, targetUserId: parsed.target_user_id };
  let command: QueuedCommand;
  const detectionCommand = decodeFamilyCommand(parsed, reason);
  if (detectionCommand) {
    command = detectionCommand;
  } else {
    switch (parsed.action_type) {
      case 'open_case_from_observed_detection':
        command = queuedCommandSchema.parse({
          ...target,
          detectionEventId: parsed.detection_event_id,
          reportId: parsed.report_intake_id ?? null,
        });
        break;
      case 'open_admin_case':
        command = queuedCommandSchema.parse({
          ...target,
          intent: 'dashboard_case_open',
          reason,
          detectionEventId: parsed.detection_event_id ?? null,
          selectedMessage:
            metadata.source_channel_id || metadata.source_message_id
              ? { channelId: metadata.source_channel_id, messageId: metadata.source_message_id }
              : null,
        });
        break;
      case 'repair_active_case':
        command = queuedCommandSchema.parse({
          ...target,
          caseId: parsed.verification_event_id,
          mode: metadata.case_action === 'create_thread' ? 'create_thread' : 'repair_thread',
        });
        break;
      case 'preview_account_quarantine':
      case 'quarantine_compromised_account':
        command = queuedCommandSchema.parse({
          ...target,
          caseId: parsed.verification_event_id,
          ...(parsed.action_type === 'quarantine_compromised_account'
            ? {
                reason,
                previewReference: {
                  kind: 'persisted_preview',
                  requestId: metadata.preview_request_id,
                },
              }
            : {}),
        });
        break;
      case 'manual_flag_user':
        command = queuedCommandSchema.parse({ ...target, reason });
        break;
      case 'kick_case_user':
      case 'ban_case_user':
      case 'ban_case_user_by_id':
        command = queuedCommandSchema.parse({
          ...target,
          caseId: parsed.verification_event_id,
          reason,
          detectionEventId: parsed.detection_event_id ?? null,
        });
        break;
      default:
        command = queuedCommandSchema.parse({ ...target, caseId: parsed.verification_event_id });
    }
  }
  return {
    context: {
      guildId: parsed.server_id,
      requestId: parsed.id,
      source: parsed.actor_surface,
      actor: { kind: 'user', userId: parsed.actor_id },
    },
    command,
  };
}

function decodeFamilyCommand(row: QueuedRow, reason: string | null): QueuedCommand | null {
  return (
    decodeOperationCommand(row) ??
    decodeMessageCleanupCommand(row) ??
    decodeCaptchaCommand(row) ??
    decodeDetectionCommand(row, reason)
  );
}
