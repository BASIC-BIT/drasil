import type { CaseAction, CaseSummary, ModerationInboxAction } from '@drasil/contracts';

/** The existing case-kind restriction, shared by reads and ordinary/specialized controls. */
export function filterCaseKindActions<Action extends CaseAction | ModerationInboxAction>(
  detail: Pick<CaseSummary, 'caseKind'>,
  actions: readonly Action[]
): Action[] {
  return detail.caseKind === 'compromised_account'
    ? actions.filter((action) => action !== 'close_no_action')
    : [...actions];
}
