import { z } from 'zod';
const id = z.string().min(1);
export const queuedQuarantineCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('preview_account_quarantine'), caseId: id, targetUserId: id })
    .strict(),
  z
    .object({
      kind: z.literal('quarantine_compromised_account'),
      caseId: id,
      targetUserId: id,
      reason: z.string().trim().min(1),
      previewReference: z.object({ kind: z.literal('persisted_preview'), requestId: id }).strict(),
    })
    .strict(),
]);
export type QueuedQuarantineCommand = z.infer<typeof queuedQuarantineCommandSchema>;
