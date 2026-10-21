import { createWorkflowTools, type WorkflowToolDependencies } from './bindings';
export type ContainmentToolDependencies = WorkflowToolDependencies;
export function createContainmentTools(deps: ContainmentToolDependencies) {
  return createWorkflowTools(deps, ['cleanup', 'quarantine', 'captcha', 'attention']);
}
export { createContainmentIntentResolver } from '@drasil/application';
