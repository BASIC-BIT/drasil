import type {
  CloseSubmittedReportResult,
  OpenSubmittedReportCaseResult,
  AttentionOutcome as AcknowledgeQueueAttentionResult,
} from '@drasil/application';
import type { ReportQueueAction } from '@drasil/contracts';
import type { WebCaseAction } from './activeCaseDataAdapter';
import type { ObservedAlertWebAction } from './observedAlertActionQueue';
import type { ModerationActionRequestReceipt } from './moderationActionRequestQueue';

export type WorkspaceMutationResult =
  | { kind: 'request'; receipt: ModerationActionRequestReceipt }
  | { kind: 'report_closure'; result: CloseSubmittedReportResult }
  | { kind: 'report_open'; result: OpenSubmittedReportCaseResult }
  | { kind: 'attention'; result: AcknowledgeQueueAttentionResult }
  | { kind: 'failed'; message: string };
export type WorkspaceMutation = (formData: FormData) => Promise<WorkspaceMutationResult>;
export interface WorkspaceActions {
  caseAction(
    input: { guildId: string; caseId: string; action: WebCaseAction },
    formData: FormData
  ): Promise<WorkspaceMutationResult>;
  reportAction(
    input: {
      guildId: string;
      reportId: string;
      action: Exclude<ReportQueueAction, 'open_report_thread'>;
    },
    formData: FormData
  ): Promise<WorkspaceMutationResult>;
  observedAction(
    input: { guildId: string; detectionId: string; action: ObservedAlertWebAction },
    formData: FormData
  ): Promise<WorkspaceMutationResult>;
  attentionAction(
    input: { guildId: string; queueItemId: string },
    formData: FormData
  ): Promise<WorkspaceMutationResult>;
}
