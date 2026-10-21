import { z } from 'zod';
import type { DelegatedPrincipal, DelegatedActionService } from '@drasil/application';

export const confirmationInputSchema = z
  .object({ confirmationId: z.string().min(1).max(128) })
  .strict();
/** Public clients cannot provide a method, replacement command or authority facts. */
export function createMcpIntentHandlers(service: DelegatedActionService) {
  return {
    async confirmAction(principal: DelegatedPrincipal, input: unknown) {
      const { confirmationId } = confirmationInputSchema.parse(input);
      return service.confirm(principal, confirmationId, 'client_confirmation');
    },
    async cancelAction(principal: DelegatedPrincipal, input: unknown) {
      const { confirmationId } = confirmationInputSchema.parse(input);
      return service.cancel(principal, confirmationId);
    },
  };
}
