import { z } from 'zod';
import {
  workflowDefinitions,
  type DelegatedPrincipal,
  type WorkflowDefinition,
} from '@drasil/application';
import type { StandardSchemaWithJSON, ToolAnnotations } from '@drasil/mcp-runtime/server';
import { toMcpSchema } from './schemas';

export interface McpWorkflowManifestEntry extends WorkflowDefinition {
  readonly schema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
}
export interface McpToolDefinition<Result = unknown> extends McpWorkflowManifestEntry {
  readonly handler: (principal: DelegatedPrincipal, input: unknown) => Promise<Result>;
}

export const mcpWorkflowManifest: readonly McpWorkflowManifestEntry[] = workflowDefinitions.map(
  (definition) => ({
    ...definition,
    schema: toMcpSchema(
      definition.inputSchema
        .extend({
          guildId: z.string().min(1),
          idempotencyKey: z.string().min(1).max(128),
        })
        .strict()
    ),
    annotations: {
      // Workflow-specific read/preview hints are refined by the owning tool family.
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  })
);

/** Family composition must supply a working handler; discovery has no runtime stubs. */
export function bindMcpTool<Result>(
  definition: McpWorkflowManifestEntry,
  handler: McpToolDefinition<Result>['handler']
): McpToolDefinition<Result> {
  return { ...definition, handler };
}
