export const CASE_ROLE_RELEASE_ATTEMPT_PREFIX = 'case-role-release:';
export const CASE_ROLE_RELEASE_LEASE_MS = 5 * 60 * 1000;

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
