import { createWorkflowTools, type WorkflowToolDependencies } from './bindings';
export type ReportToolDependencies = WorkflowToolDependencies;
export function createReportTools(deps: ReportToolDependencies) {
  return createWorkflowTools(deps, ['reports', 'detections', 'reportReview']);
}
export { createReportIntentResolver } from '@drasil/application';
