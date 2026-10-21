import { z } from 'zod';
import { type DelegatedActionService, type PublicActionResult } from '@drasil/application';
import { bindMcpTool, mcpWorkflowManifest, type McpToolDefinition } from '../manifest';
export interface SetupToolDependencies {
  readonly service: Pick<DelegatedActionService, 'submit'>;
}
export function createSetupTools(
  deps: SetupToolDependencies
): readonly McpToolDefinition<PublicActionResult>[] {
  return mcpWorkflowManifest
    .filter((entry) => ['setup', 'operations'].includes(entry.family))
    .map((entry) =>
      bindMcpTool(entry, async (principal, input) => {
        const { guildId, idempotencyKey, ...options } = entry.inputSchema
          .extend({
            guildId: z.string().regex(/^\d{17,20}$/),
            idempotencyKey: z.string().min(1).max(128),
          })
          .strict()
          .parse(input);
        return deps.service.submit(principal, {
          workflowId: entry.id,
          guildId: z.string().parse(guildId),
          idempotencyKey: z.string().parse(idempotencyKey),
          input: options,
        });
      })
    );
}
export { createSetupIntentResolver } from '@drasil/application';
