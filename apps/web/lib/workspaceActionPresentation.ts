import type { CaseDetail, MessageCleanupJobDetail, ReportDetail } from '@drasil/contracts';
import { isMessageCleanupFinalizationRetry } from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import type { WorkspaceMutationResult } from './workspaceActionTypes';

export type WorkspaceActionPresentation = {
  readonly kind:
    | 'idle'
    | 'pending'
    | 'completed'
    | 'blocked'
    | 'failed_uncertain'
    | 'banned_updates_pending'
    | 'ban_outcome_unknown'
    | 'ban_reviewed_no_current_ban'
    | 'finalization_retry';
  readonly message: string;
};
export interface WorkspaceActionPresentationInput {
  readonly localResult: WorkspaceMutationResult | null;
  readonly durableRequest: ModerationActionRequestSummary | null;
  readonly cleanupJob: MessageCleanupJobDetail | null;
  readonly record: CaseDetail | ReportDetail | null;
}
type ReportClosureResult = Extract<WorkspaceMutationResult, { kind: 'report_closure' }>['result'];
type ReportOpenResult = Extract<WorkspaceMutationResult, { kind: 'report_open' }>['result'];

export function deriveWorkspaceActionPresentation({
  localResult,
  durableRequest,
  cleanupJob,
  record,
}: WorkspaceActionPresentationInput): WorkspaceActionPresentation {
  const banStatus = durableRequest?.observedBanResult?.status;
  if (banStatus === 'ban_reviewed_no_current_ban')
    return {
      kind: 'ban_reviewed_no_current_ban',
      message:
        'Reviewed: no current ban. The historical outcome remains uncertain. Any new action requires fresh eligibility and confirmation.',
    };
  if (banStatus === 'ban_outcome_unknown')
    return {
      kind: 'ban_outcome_unknown',
      message: 'Ban outcome unknown. Review the durable operation before another ban attempt.',
    };
  if (banStatus === 'banned_updates_pending')
    return {
      kind: 'banned_updates_pending',
      message: 'Member banned. Record and notification updates are pending.',
    };
  if (banStatus === 'banned') return { kind: 'completed', message: 'Member banned.' };
  const activeStatus =
    durableRequest?.status ?? (localResult?.kind === 'request' ? localResult.receipt.status : null);
  if (cleanupJob && (activeStatus === 'queued' || activeStatus === 'processing')) {
    return {
      kind: 'pending',
      message: activeStatus === 'queued' ? 'Request queued.' : 'Request processing.',
    };
  }
  if (cleanupJob && isMessageCleanupFinalizationRetry(cleanupJob))
    return {
      kind: 'finalization_retry',
      message: 'Member banned. Cleanup finished; case finalization needs a retry.',
    };
  if (durableRequest) return requestPresentation(durableRequest.status, durableRequest.lastError);
  if (!localResult) return { kind: 'idle', message: '' };
  switch (localResult.kind) {
    case 'failed':
      return { kind: 'failed_uncertain', message: localResult.message };
    case 'request':
      return requestPresentation(localResult.receipt.status);
    case 'report_closure':
      return reportClosurePresentation(localResult.result, record);
    case 'report_open':
      return reportOpenPresentation(localResult.result);
    case 'attention':
      return localResult.result.status === 'acknowledged'
        ? { kind: 'completed', message: 'Reply acknowledged.' }
        : {
            kind: 'blocked',
            message: 'Reply was already handled. Refresh the record before continuing.',
          };
  }
}

const requestPresentation = (
  status: ModerationActionRequestSummary['status'],
  lastError: string | null = null
): WorkspaceActionPresentation => {
  if (status === 'queued' || status === 'processing')
    return {
      kind: 'pending',
      message: status === 'queued' ? 'Request queued.' : 'Request processing.',
    };
  if (status === 'failed')
    return {
      kind: 'failed_uncertain',
      message: lastError ?? 'Request failed. Refresh the record before another attempt.',
    };
  return { kind: 'completed', message: 'Request completed.' };
};

const reportClosurePresentation = (
  result: ReportClosureResult,
  record: WorkspaceActionPresentationInput['record']
): WorkspaceActionPresentation => {
  if (result.status !== 'closed') {
    const current =
      record && record.id === result.reportId && 'targetUserId' in record
        ? ` Current report status: ${record.status}.`
        : '';
    return {
      kind: 'blocked',
      message: `${result.status === 'busy' ? 'Another operation owns this report.' : 'Report closure was not applied by this request.'}${current} Refresh the report before continuing.`,
    };
  }
  const status = {
    dismissed: 'dismissed',
    actioned: 'marked handled',
    false_positive: 'marked false positive',
  }[result.reportStatus];
  return {
    kind: 'completed',
    message: `Report ${status}.${result.queueCleanupStatus === 'failed' ? ' Queue notification cleanup failed.' : ''}`,
  };
};

const reportOpenPresentation = (result: ReportOpenResult): WorkspaceActionPresentation => {
  if (result.status === 'queued') return { kind: 'pending', message: 'Open case request queued.' };
  if (result.status === 'opened' || result.status === 'case_exists')
    return {
      kind: 'completed',
      message: `${result.status === 'opened' ? 'Case opened.' : 'A linked case already exists.'}${result.queueCleanupStatus === 'failed' ? ' Queue notification cleanup failed.' : ''}`,
    };
  return {
    kind: 'blocked',
    message: 'Case opening was not applied. Refresh the report before continuing.',
  };
};
