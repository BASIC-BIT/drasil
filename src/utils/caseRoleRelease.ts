export const CASE_ROLE_RELEASE_ATTEMPT_PREFIX = 'case-role-release:';
export const CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX = 'case-role-release-reconciliation:';
export const CASE_ATTENTION_ATTEMPT_PREFIX = 'case-attention:';
export const CASE_TERMINAL_ACTION_ATTEMPT_PREFIX = 'case-terminal-action:';
export const CAPTCHA_FINALIZATION_ATTEMPT_PREFIX = 'captcha-finalization:';
export const CAPTCHA_PRESENTATION_ATTEMPT_PREFIX = 'captcha-presentation:';
export const CASE_ROLE_RELEASE_LEASE_MS = 5 * 60 * 1000;

export function isCaseAttentionAttempt(attemptId: string | null | undefined): boolean {
  return attemptId?.startsWith(CASE_ATTENTION_ATTEMPT_PREFIX) === true;
}

export function isCaseTerminalActionAttempt(attemptId: string | null | undefined): boolean {
  return attemptId?.startsWith(CASE_TERMINAL_ACTION_ATTEMPT_PREFIX) === true;
}

export function isCaptchaPresentationAttempt(attemptId: string | null | undefined): boolean {
  return attemptId?.startsWith(CAPTCHA_PRESENTATION_ATTEMPT_PREFIX) === true;
}

export function isCaseRoleReleaseRecoveryAttempt(attemptId: string | null | undefined): boolean {
  return (
    attemptId?.startsWith(CASE_ROLE_RELEASE_ATTEMPT_PREFIX) === true ||
    attemptId?.startsWith(CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX) === true
  );
}

export function isCaseRoleReleaseLeaseActive(
  attemptId: string | null | undefined,
  leaseRenewedAt: Date | null | undefined,
  now = new Date()
): boolean {
  return (
    attemptId?.startsWith(CASE_ROLE_RELEASE_ATTEMPT_PREFIX) === true &&
    leaseRenewedAt !== null &&
    leaseRenewedAt !== undefined &&
    leaseRenewedAt.getTime() > now.getTime() - CASE_ROLE_RELEASE_LEASE_MS
  );
}
