import { z } from 'zod';
import { type DelegatedActionService, type PublicActionResult } from '@drasil/application';
import { bindMcpTool, mcpWorkflowManifest, type McpToolDefinition } from '../manifest';

export interface ContainmentToolDependencies {
  readonly service: Pick<DelegatedActionService, 'submit'>;
}
export function createContainmentTools(
  deps: ContainmentToolDependencies
): readonly McpToolDefinition<PublicActionResult>[] {
  return mcpWorkflowManifest
    .filter((entry) => ['cleanup', 'quarantine', 'captcha', 'attention'].includes(entry.family))
    .map((entry) =>
      bindMcpTool(entry, async (principal, input) => {
        const parsed = entry.inputSchema
          .extend({
            guildId: z.string().regex(/^\d{17,20}$/),
            idempotencyKey: z.string().min(1).max(128),
          })
          .strict()
          .parse(input);
        const { guildId: rawGuild, idempotencyKey: rawKey, ...options } = parsed;
        const guildId = z.string().parse(rawGuild);
        const idempotencyKey = z.string().parse(rawKey);
        return deps.service.submit(principal, {
          workflowId: entry.id,
          guildId,
          idempotencyKey,
          input: options,
        });
      })
    );
}

export { createContainmentIntentResolver } from '@drasil/application';
