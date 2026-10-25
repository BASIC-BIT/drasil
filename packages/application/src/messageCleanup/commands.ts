import { z } from 'zod';
const id = z.string().min(1);
export const cleanupModeSchema = z.enum(['delete_only', 'ban_with_cleanup']);
export const cleanupScopeSchema = z.enum([
  'source_message',
  'last_hour',
  'last_day',
  'last_7_days',
]);
const binding = {
  jobId: id,
  caseId: id,
  targetUserId: id,
  mode: cleanupModeSchema,
  scope: cleanupScopeSchema,
  reason: z.string().max(1000),
  detectionEventId: id.nullable(),
  previewReference: z.object({ jobId: id, generation: z.string().nullable() }).strict(),
};
export const messageCleanupCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('preview_case_message_deletion'), ...binding }).strict(),
  z
    .object({
      kind: z.literal('execute_case_message_deletion'),
      ...binding,
      mode: z.literal('delete_only'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('ban_case_user_with_message_cleanup'),
      ...binding,
      mode: z.literal('ban_with_cleanup'),
    })
    .strict(),
]);
export type MessageCleanupCommand = z.infer<typeof messageCleanupCommandSchema>;
