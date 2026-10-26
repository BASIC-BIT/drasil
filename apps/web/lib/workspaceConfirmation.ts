import { resolveSafeReturnPath } from './safeReturn';

export function assertWorkspaceConfirmation(
  formData: FormData,
  expected: { readonly recordId: string; readonly targetUserId: string | null }
): void {
  if (
    formData.get('confirmAction') !== 'on' ||
    formData.get('confirmedRecordId') !== expected.recordId ||
    (expected.targetUserId !== null &&
      formData.get('confirmedTargetUserId') !== expected.targetUserId)
  ) {
    throw new Error('Review and confirm the current record and member before submitting.');
  }
}

export function resolveWorkspaceReturnTo(
  formData: FormData,
  guildId: string,
  fallback: string
): string {
  const value = formData.get('returnTo');
  const path = resolveSafeReturnPath(typeof value === 'string' ? value : null, fallback);
  const prefix = `/admin/guild/${encodeURIComponent(guildId)}/`;
  return path.startsWith(prefix) ? path : fallback;
}
