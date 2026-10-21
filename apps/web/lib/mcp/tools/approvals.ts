import { z } from 'zod';
import type { DelegatedActionService, PublicActionResult } from '@drasil/application';
import { confirmMcpAction, getMcpActionStatus } from '../delivery';
import { confirmationInputSchema } from '../intents';
import { toMcpSchema } from '../schemas';
import type { McpPublicToolDefinition } from '../manifest';
export function createApprovalTools(
  service: DelegatedActionService
): readonly McpPublicToolDefinition<PublicActionResult>[] {
  return [
    {
      toolName: 'confirm_action',
      scope: 'saved_action',
      description:
        'Confirm the exact previously shown saved summary after obtaining the user’s approval. The ID alone is not evidence of human presence.',
      schema: toMcpSchema(confirmationInputSchema),
      resultContract: 'action',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
      handler: async (principal, input) =>
        confirmMcpAction(
          service,
          principal,
          confirmationInputSchema.parse(input).confirmationId,
          'client_confirmation'
        ),
    },
    {
      toolName: 'cancel_action',
      scope: 'saved_action',
      description: 'Cancel a saved confirmation attempt.',
      schema: toMcpSchema(confirmationInputSchema),
      resultContract: 'action',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async (principal, input) =>
        service.cancel(principal, confirmationInputSchema.parse(input).confirmationId),
    },
    {
      toolName: 'get_action_status',
      scope: 'drasil:read',
      description:
        'Poll your own execution receipt. Current connection and read authority are checked.',
      schema: toMcpSchema(executionInputSchema),
      resultContract: 'action',
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      handler: async (principal, input) =>
        getMcpActionStatus(service, principal, executionInputSchema.parse(input).executionId),
    },
  ];
}
const executionInputSchema = z.object({ executionId: z.string().uuid() }).strict();
