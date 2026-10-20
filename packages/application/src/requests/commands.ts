import { z } from 'zod';

export const queuedCommandSchema = z
  .object({
    kind: z.literal('open_case_from_observed_detection'),
    detectionEventId: z.string().min(1),
    targetUserId: z.string().min(1),
    reportId: z.string().min(1).nullable(),
  })
  .strict();
export type QueuedCommand = z.infer<typeof queuedCommandSchema>;
