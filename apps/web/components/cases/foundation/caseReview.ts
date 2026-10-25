import type { CaseAction, CaseDetail } from '@drasil/contracts';
import type { InboxActionState } from '@/lib/inboxActionState';

export type CaseDecision = Extract<
  CaseAction,
  'verify_user' | 'close_no_action' | 'kick_user' | 'ban_user'
>;
export type CaseDecisionResult = Omit<InboxActionState, 'status'> & {
  readonly status: Exclude<InboxActionState['status'], 'idle'>;
};
export type CaseDecisionHandler = (
  caseId: CaseDetail['id'],
  action: CaseDecision,
  reason: string
) => Promise<CaseDecisionResult>;
export type CaseRequestState =
  | { readonly kind: 'ready' }
  | { readonly kind: 'submitting'; readonly action: CaseDecision }
  | {
      readonly kind: 'settled';
      readonly action: CaseDecision;
      readonly result: CaseDecisionResult;
    };

export const caseDecisions: readonly CaseDecision[] = [
  'verify_user',
  'close_no_action',
  'kick_user',
  'ban_user',
];
export const decisionLabels: Record<CaseDecision, string> = {
  verify_user: 'Verify member',
  close_no_action: 'Close case',
  kick_user: 'Kick member',
  ban_user: 'Ban member',
};
const requestLabels: Record<CaseDecision, string> = {
  verify_user: 'Verification',
  close_no_action: 'Closure',
  kick_user: 'Kick',
  ban_user: 'Ban',
};
export function caseRequestLabel(state: CaseRequestState): string | null {
  if (state.kind === 'ready') return null;
  const label = requestLabels[state.action];
  if (state.kind === 'submitting') return `Submitting ${label.toLowerCase()} request…`;
  switch (state.result.status) {
    case 'queued':
      return `${label} request queued`;
    case 'processing':
      return `${label} request processing`;
    case 'completed':
      return `${label} request completed`;
    case 'failed':
      return `${label} request failed`;
  }
}
