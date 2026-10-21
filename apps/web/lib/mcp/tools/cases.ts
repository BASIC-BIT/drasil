import {
  caseCommandSchema,
  caseActionSummary,
  resolveCasePreconditions,
  workflowDefinitions,
  ActionDeniedError,
  IntentError,
  type DelegatedAccess,
  type IntentResolver,
  type CaseResolutionDependencies,
  type DelegatedPrincipal,
  type WorkflowId,
} from '@drasil/application';
import { createWorkflowTools, type WorkflowToolDependencies } from './bindings';

export type CaseToolDependencies = WorkflowToolDependencies;
export function createCaseTools(deps: CaseToolDependencies) {
  return createWorkflowTools(deps, ['cases']);
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
      return {
        delivery: { kind: 'queued', command },
        preconditions,
        relevantState: preconditions,
        previewExpiresAt: null,
        summary: caseActionSummary(command),
      };
    },
  };
}
