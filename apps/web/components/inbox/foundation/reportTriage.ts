import type { ReportDetail, ReportQueueAction } from '@drasil/contracts';
import type { InboxActionState } from '@/lib/inboxActionState';

export type ReportTriageAction = Extract<
  ReportQueueAction,
  'open_case' | 'dismiss_no_action' | 'mark_false_positive' | 'mark_actioned'
>;
export type ReportActionHandler = (
  reportId: ReportDetail['id'],
  action: ReportTriageAction
) => Promise<InboxActionState>;
export type ReportReviewState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'submitting'; readonly action: ReportTriageAction }
  | {
      readonly kind: 'settled';
      readonly action: ReportTriageAction;
      readonly result: InboxActionState;
    };

export const readyReport: ReportReviewState = { kind: 'ready' };
export const actionLabels: Record<ReportTriageAction, string> = {
  open_case: 'Open case',
  dismiss_no_action: 'Dismiss report',
  mark_false_positive: 'Mark false positive',
  mark_actioned: 'Mark handled',
};
export const resultLabels: Record<ReportTriageAction, string> = {
  open_case: 'Case opened',
  dismiss_no_action: 'Report dismissed',
  mark_false_positive: 'Marked as false positive',
  mark_actioned: 'Report marked handled',
};

export function reportActionLabel(state: ReportReviewState): string | null {
  if (state.kind === 'ready') return null;
  if (state.kind === 'submitting')
    return state.action === 'open_case' ? 'Requesting case…' : 'Saving…';
  switch (state.result.status) {
    case 'idle':
      return null;
    case 'queued':
      return state.action === 'open_case' ? 'Case request queued' : 'Report update queued';
    case 'processing':
      return state.action === 'open_case' ? 'Case request processing' : 'Updating report';
    case 'completed':
      return resultLabels[state.action];
    case 'failed':
      return state.action === 'open_case' ? 'Case request failed' : 'Report update failed';
  }
}

export function isReportClosed(state: ReportReviewState): boolean {
  return (
    state.kind === 'settled' && state.action !== 'open_case' && state.result.status === 'completed'
  );
}

export function reportName(report: ReportDetail): string {
  return report.targetDisplayName ?? report.targetUserId ?? 'Unconfirmed member';
}
