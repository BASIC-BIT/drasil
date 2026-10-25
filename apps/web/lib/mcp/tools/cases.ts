import { createWorkflowTools, type WorkflowToolDependencies } from './bindings';
export type CaseToolDependencies = WorkflowToolDependencies;
export function createCaseTools(deps: CaseToolDependencies) {
  return createWorkflowTools(deps, ['cases']);
}
