import type { QueuedCommand } from '../requests/commands';
import { z } from 'zod';
const id = z.string().min(1);
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
  z.object({ kind: z.literal('close_report_intake'), intakeId: id }).strict(),
]);
export const reportCommandSchema = z.union([
  queuedReportCommandSchema,
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
      intakeId: id,
      threadId: id,
      promptMessageId: id,
      targetUserId: id,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reject_intake_candidates'),
      intakeId: id,
      threadId: id,
      promptMessageId: id,
      promptToken: id,
    })
    .strict(),
]);
export type ReportCommand = z.infer<typeof reportCommandSchema>;
export type QueuedReportCommand = z.infer<typeof queuedReportCommandSchema>;
export function isQueuedReportKind(kind: string): kind is QueuedReportCommand['kind'] {
  return (
    kind === 'submit_user_report' ||
    kind === 'start_report_intake' ||
    kind === 'close_report_intake'
  );
}
export function isQueuedReportCommand(
  command: QueuedCommand | ReportCommand
): command is QueuedReportCommand {
  return isQueuedReportKind(command.kind);
}
