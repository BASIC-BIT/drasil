import { createWorkflowTools, type WorkflowToolDependencies } from './bindings';
export type SetupToolDependencies = WorkflowToolDependencies;
export function createSetupTools(deps: SetupToolDependencies) {
  return createWorkflowTools(deps, ['setup', 'operations']);
}
export { createSetupIntentResolver } from '@drasil/application';
