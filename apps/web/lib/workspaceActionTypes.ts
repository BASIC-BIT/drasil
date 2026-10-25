import type { InboxStateAction } from '@/components/inbox/InboxActionForm';
import { initialInboxActionState } from './inboxActionState';
import type {
  MessageCleanupCommand,
  CloseSubmittedReportResult,
  OpenSubmittedReportCaseResult,
  AttentionOutcome as AcknowledgeQueueAttentionResult,
} from '@drasil/application';
import type { ModerationInboxAction, ReportQueueAction } from '@drasil/contracts';
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

/** Adapt the returned durable receipt; submission itself does not imply queueing. */
export function adaptInboxStateAction(action: InboxStateAction): WorkspaceMutation {
  return async (formData) => {
    const result = await action(initialInboxActionState, formData);
    if (result.requestId && result.status !== 'idle') {
      return { kind: 'request', receipt: { id: result.requestId, status: result.status } };
    }
    return {
      kind: 'failed',
      message: result.message ?? 'No durable request receipt was returned.',
    };
  };
}

export type CleanupActionId = MessageCleanupCommand['kind'];
export type WorkspaceConfirmedActionId = ModerationInboxAction | CleanupActionId;
