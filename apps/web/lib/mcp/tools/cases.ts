import { z } from 'zod';
import {
  caseCommandSchema,
  resolveCasePreconditions,
  workflowDefinitions,
  ActionDeniedError,
  IntentError,
  type DelegatedAccess,
  type DelegatedActionService,
  type IntentResolver,
  type CaseResolutionDependencies,
  type DelegatedPrincipal,
  type WorkflowId,
  type PublicActionResult,
} from '@drasil/application';
import { bindMcpTool, mcpWorkflowManifest, type McpToolDefinition } from '../manifest';

export interface CaseToolDependencies {
  readonly service: Pick<DelegatedActionService, 'submit'>;
}
export function createCaseTools(
  deps: CaseToolDependencies
): readonly McpToolDefinition<PublicActionResult>[] {
  return mcpWorkflowManifest
    .filter((entry) => entry.family === 'cases')
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
export interface CaseIntentDependencies {
  readonly access: DelegatedAccess;
  readonly resources: (
    principal: DelegatedPrincipal,
    guildId: string,
    workflowId: WorkflowId
  ) => CaseResolutionDependencies;
}
/** Register only this family; other families must supply their own real resolvers. */
export function createCaseIntentResolver(deps: CaseIntentDependencies): IntentResolver {
  return {
    async resolve(principal, invocation) {
      const workflow = workflowDefinitions.find(
        (entry) => entry.id === invocation.workflowId && entry.family === 'cases'
      );
      if (!workflow) throw new ActionDeniedError('unsupported_case_workflow');
      const authority = await deps.access.authorizeWorkflowId(
        principal,
        invocation.guildId,
        workflow.id
      );
      if (authority.kind === 'denied') throw new ActionDeniedError(authority.reason);
      const command = caseCommandSchema.parse(workflow.parseCommand(invocation.input));
      const preconditions = await resolveCasePreconditions(
        invocation.guildId,
        command,
        deps.resources(principal, invocation.guildId, workflow.id)
      ).catch((error: unknown) => {
        if (error instanceof ActionDeniedError) throw new IntentError(error.code);
        throw error;
      });
      const native = command.kind === 'ban_user' || command.kind === 'kick_user';
      return {
        delivery: { kind: 'queued', command },
        preconditions,
        relevantState: preconditions,
        previewExpiresAt: null,
        summary: `${command.kind.replace(/_/g, ' ')} for ${command.targetUserId}.${native ? ' If a previous attempt is uncertain, its historical outcome remains unknown. A fresh intent and key starts a separate attempt that may repeat an effect.' : ''}`,
      };
    },
  };
}
