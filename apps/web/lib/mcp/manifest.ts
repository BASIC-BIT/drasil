import { z } from 'zod';
import {
  workflowDefinitions,
  type DelegatedPrincipal,
  type DelegatedScope,
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
    schema: toMcpSchema(workflowToolSchema(definition)),
    annotations: {
      // Workflow-specific read/preview hints are refined by the owning tool family.
      readOnlyHint: false,
      destructiveHint: !/^(?:preview_|prepare_|audit_|refresh_)/.test(definition.id),
      idempotentHint: true,
      openWorldHint: true,
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

/** Common transport input; workflow entries retain their complete canonical metadata. */
export interface McpPublicToolDefinition<Result = unknown> {
  readonly toolName: string;
  readonly scope: DelegatedScope | 'saved_action';
  readonly description?: string;
  readonly schema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
  readonly resultContract: string;
  readonly handler: (principal: DelegatedPrincipal, input: unknown) => Promise<Result>;
}

export function workflowToolSchema(entry: WorkflowDefinition) {
  return entry.inputSchema
    .extend({
      guildId: z.string().regex(/^\d{17,20}$/),
      idempotencyKey: z.string().min(1).max(128),
    })
    .strict();
}
