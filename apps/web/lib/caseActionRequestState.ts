import type { CaseAction } from '@drasil/contracts';

export function resolveDurableRequestForCaseAction<T extends { readonly status: string }>(
  action: CaseAction,
  request: T | null | undefined
): T | null | undefined {
  return action === 'quarantine_compromised_account' && request?.status === 'completed'
    ? null
    : request;
}
