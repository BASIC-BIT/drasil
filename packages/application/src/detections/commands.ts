import { z } from 'zod';
const id = z.string().min(1);
const target = { targetUserId: id, detectionEventId: id };
const reason = z.string().max(1000).nullable();
export const queuedDetectionCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('dismiss_observed_detection'), ...target }).strict(),
  z.object({ kind: z.literal('mark_observed_detection_false_positive'), ...target }).strict(),
  z.object({ kind: z.literal('undo_observed_detection_action'), ...target }).strict(),
  z.object({ kind: z.literal('kick_observed_detection'), ...target, reason }).strict(),
  z
    .object({
      kind: z.literal('ban_observed_detection'),
      ...target,
      reason,
      subject: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('observed') }).strict(),
        z.object({ kind: z.literal('report'), reportId: id }).strict(),
      ]),
    })
    .strict(),
  z.object({ kind: z.literal('ignore_detection_accounting'), ...target, reason }).strict(),
  z.object({ kind: z.literal('restore_detection_accounting'), ...target, reason }).strict(),
  z.object({ kind: z.literal('prepare_report_ban_review'), operationId: id }).strict(),
  z
    .object({
      kind: z.literal('review_uncertain_report_ban'),
      operationId: id,
      targetUserId: id,
      reviewReference: id,
      reason: z.string().min(1).max(1000),
    })
    .strict(),
]);
export const detectionCommandSchema = queuedDetectionCommandSchema;
export type QueuedDetectionCommand = z.infer<typeof queuedDetectionCommandSchema>;
export type DetectionCommand = z.infer<typeof detectionCommandSchema>;
