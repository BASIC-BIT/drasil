import { z } from 'zod';
import type {
  DelegatedActionService,
  IntentInvocation,
  PublicActionResult,
  WorkflowDefinition,
} from '@drasil/application';
import {
  bindMcpTool,
  mcpWorkflowManifest,
  workflowToolSchema,
  type McpToolDefinition,
} from '../manifest';

export interface WorkflowToolDependencies {
  readonly service: Pick<DelegatedActionService, 'submit'>;
}
export function parseMcpInvocation(entry: WorkflowDefinition, input: unknown): IntentInvocation {
  const { guildId, idempotencyKey, ...options } = workflowToolSchema(entry).parse(input);
  return {
    workflowId: entry.id,
    guildId: z.string().parse(guildId),
    idempotencyKey: z.string().parse(idempotencyKey),
    input: options,
  };
}
/** Only trusted factories choose families; public callers never select a workflow. */
export function createWorkflowTools(
  deps: WorkflowToolDependencies,
  families: readonly WorkflowDefinition['family'][]
): readonly McpToolDefinition<PublicActionResult>[] {
  return mcpWorkflowManifest
    .filter((entry) => families.includes(entry.family))
    .map((entry) =>
      bindMcpTool(entry, async (principal, input) =>
        deps.service.submit(principal, parseMcpInvocation(entry, input))
      )
    );
}
