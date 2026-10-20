import type {
  ActionContext,
  MessageCleanupActions,
  MessageCleanupCommand,
} from '@drasil/application';
import { requireMessageCleanupOutcome } from './adapters/messageCleanup';
type CleanupReceiptBinding = { readonly message_deletion_job_id: string; readonly mode: string };
export type QueuedMessageCleanupOutcome = CleanupReceiptBinding &
  (
    | {
        readonly action_type: 'preview_case_message_deletion';
        readonly candidate_count: number;
        readonly coverage: string | null;
        readonly scope: string;
        readonly status: string;
        readonly target_user_id: string;
        readonly verification_event_id: string;
      }
    | (CleanupCountsReceipt &
        (
          | { readonly action_type: 'execute_case_message_deletion' }
          | {
              readonly action_type: 'ban_case_user_with_message_cleanup';
              readonly banned: boolean;
              readonly case_finalized: boolean;
            }
        ))
  );
type CleanupCountsReceipt = {
  readonly already_completed: boolean;
  readonly preserved_count: number;
  readonly deleted_count: number;
  readonly already_missing_count: number;
  readonly changed_since_preview_count: number;
  readonly evidence_failed_count: number;
  readonly delete_failed_count: number;
  readonly permission_denied_count: number;
};
export async function dispatchMessageCleanupAction(
  actions: MessageCleanupActions,
  context: ActionContext,
  command: MessageCleanupCommand
): Promise<QueuedMessageCleanupOutcome> {
  const outcome = requireMessageCleanupOutcome(await actions.execute(context, command));
  const binding = { message_deletion_job_id: outcome.job.id, mode: outcome.job.mode };
  if (outcome.kind === 'preview_case_message_deletion')
    return {
      ...binding,
      action_type: outcome.kind,
      candidate_count: outcome.job.candidateCount,
      coverage: outcome.job.coverage,
      scope: outcome.job.scope,
      status: outcome.job.status,
      target_user_id: outcome.job.targetUserId,
      verification_event_id: outcome.job.caseId,
    };
  const counts = {
    ...binding,
    already_completed: outcome.alreadyCompleted,
    preserved_count: outcome.preservedCount,
    deleted_count: outcome.deletedCount,
    already_missing_count: outcome.alreadyMissingCount,
    changed_since_preview_count: outcome.changedCount,
    evidence_failed_count: outcome.evidenceFailedCount,
    delete_failed_count: outcome.deleteFailedCount,
    permission_denied_count: outcome.permissionDeniedCount,
  };
  return outcome.kind === 'ban_case_user_with_message_cleanup'
    ? {
        ...counts,
        action_type: outcome.kind,
        banned: outcome.banned,
        case_finalized: outcome.caseFinalized,
      }
    : { ...counts, action_type: outcome.kind };
}
