import { z } from 'zod';

export const confirmationInputSchema = z
  .object({ confirmationId: z.string().min(1).max(128) })
  .strict();
