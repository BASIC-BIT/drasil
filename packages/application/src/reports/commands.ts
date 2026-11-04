import type { QueuedCommand } from '../requests/commands';
import { z } from 'zod';
const id = z.string().min(1);
const expectedEvidenceRevision = z.number().int().nonnegative().optional();
export const reportCloseModeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thread_only') }).strict(),
  z
    .object({
      kind: z.literal('resolve_submission'),
      token: id,
      reason: z.string().trim().min(1).max(1000),
      verifiedOutcome: z.enum(['not_applied', 'handled_separately']),
    })
    .strict(),
  z.object({ kind: z.literal('resolve_review'), reason: z.string().trim().min(1) }).strict(),
]);
export const queuedReportCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('submit_user_report'),
      targetUserId: id,
      targetLabel: id,
      reason: z.string().nullable(),
      passUndefinedReason: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('start_report_intake'), channelId: id }).strict(),
  z
    .object({
      kind: z.literal('close_report_intake'),
      intakeId: id,
      closeMode: reportCloseModeSchema.optional(),
      expectedEvidenceRevision,
      promptMessageId: id.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('submit_message_report'),
      targetUserId: id,
      messageId: id,
      channelId: id,
      reason: z.string().nullable(),
      interactionContext: z.number().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('confirm_intake_candidate'),
      expectedEvidenceRevision,
      intakeId: id,
      threadId: id,
      promptMessageId: id,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reject_intake_candidates'),
      expectedEvidenceRevision,
      intakeId: id,
      threadId: id,
      promptMessageId: id,
      promptToken: id,
    })
    .strict(),
]);
export const reportCommandSchema = queuedReportCommandSchema;
export type ReportCommand = z.infer<typeof reportCommandSchema>;
export type QueuedReportCommand = z.infer<typeof queuedReportCommandSchema>;
export function isQueuedReportKind(kind: string): kind is QueuedReportCommand['kind'] {
  return (
    kind === 'submit_user_report' ||
    kind === 'start_report_intake' ||
    kind === 'close_report_intake' ||
    kind === 'submit_message_report' ||
    kind === 'confirm_intake_candidate' ||
    kind === 'reject_intake_candidates'
  );
}
export function isQueuedReportCommand(
  command: QueuedCommand | ReportCommand
): command is QueuedReportCommand {
  return isQueuedReportKind(command.kind);
}
