import { isQueuedSetupKind } from '../setup/commands';
import { decodeSetupCommand } from './setup';
import { isQueuedReportKind } from '../reports/commands';
import { decodeReportCommand } from './reports';
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
    if (
      row.target_user_id === null &&
      !isQueuedOperationKind(row.action_type) &&
      !isQueuedReportKind(row.action_type) &&
      !isQueuedSetupKind(row.action_type) &&
      row.action_type !== 'prepare_report_ban_review'
    )
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
  const parsed = parseQueuedRow(row);
  const metadata = parsed.metadata ?? {};
  const reason = typeof metadata.reason === 'string' ? metadata.reason : null;
  const command = decodeFamilyCommand(parsed, reason) ?? decodeCaseCommand(parsed, reason);
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

const selectedMessage = (metadata: Record<string, unknown>): unknown => {
  return metadata.source_channel_id || metadata.source_message_id
    ? { channelId: metadata.source_channel_id, messageId: metadata.source_message_id }
    : null;
};
const decodeCaseCreation = (row: QueuedRow, reason: string | null): QueuedCommand | null => {
  const metadata = row.metadata ?? {};
  const target = { kind: row.action_type, targetUserId: row.target_user_id };
  switch (row.action_type) {
    case 'ban_user':
    case 'kick_user':
      return queuedCommandSchema.parse({
        ...target,
        reason,
        ...(row.action_type === 'ban_user' ? { intent: metadata.intent ?? 'native_action' } : {}),
        selectedMessage: selectedMessage(metadata),
      });
    case 'open_case_from_observed_detection':
      return queuedCommandSchema.parse({
        ...target,
        detectionEventId: row.detection_event_id,
        reportId: row.report_intake_id ?? null,
        ...(metadata.inbox_action === 'open_case'
          ? { origin: { kind: 'observed_alert', reason } }
          : {}),
      });
    case 'open_admin_case':
      return queuedCommandSchema.parse({
        ...target,
        intent: metadata.intent ?? 'dashboard_case_open',
        reason,
        detectionEventId: row.detection_event_id ?? null,
        selectedMessage: selectedMessage(metadata),
      });
    default:
      return null;
  }
};
const decodeCaseCommand = (row: QueuedRow, reason: string | null): QueuedCommand => {
  const metadata = row.metadata ?? {};
  const target = { kind: row.action_type, targetUserId: row.target_user_id };
  const creation = decodeCaseCreation(row, reason);
  if (creation) return creation;
  switch (row.action_type) {
    case 'repair_active_case':
      return queuedCommandSchema.parse({
        ...target,
        caseId: row.verification_event_id,
        intent: metadata.intent ?? 'moderator_repair',
        mode: metadata.case_action === 'create_thread' ? 'create_thread' : 'repair_thread',
      });
    case 'preview_account_quarantine':
    case 'quarantine_compromised_account':
      return queuedCommandSchema.parse({
        ...target,
        caseId: row.verification_event_id,
        ...(row.action_type === 'quarantine_compromised_account'
          ? {
              reason,
              previewReference: {
                kind: 'persisted_preview',
                requestId: metadata.preview_request_id,
              },
            }
          : {}),
      });
    case 'manual_flag_user':
      return queuedCommandSchema.parse({ ...target, reason });
    case 'kick_case_user':
    case 'ban_case_user':
    case 'ban_case_user_by_id':
      return queuedCommandSchema.parse({
        ...target,
        caseId: row.verification_event_id,
        reason,
        detectionEventId: row.detection_event_id ?? null,
      });
    default:
      return queuedCommandSchema.parse({ ...target, caseId: row.verification_event_id });
  }
};

const decodeFamilyCommand = (row: QueuedRow, reason: string | null): QueuedCommand | null => {
  return (
    decodeSetupCommand(row) ??
    decodeReportCommand(row) ??
    decodeOperationCommand(row) ??
    decodeMessageCleanupCommand(row) ??
    decodeCaptchaCommand(row) ??
    decodeDetectionCommand(row, reason)
  );
};

/** Shape validation is not authorization; workers must verify the persisted execution link. */
export const delegatedDeliveryBindingSchema = z
  .object({
    executionId: z.string().uuid(),
    connectionId: z.string().uuid(),
    grantVersion: z.number().int().positive(),
    commandDigest: z.string().regex(/^v1:sha256:[a-f0-9]{64}$/),
  })
  .strict();

export function parseQueuedRow(row: unknown): QueuedRow {
  return queuedRowSchema.parse(row);
}
