import { createHash } from 'node:crypto';
import type { AccountQuarantinePreview } from '../services/AccountQuarantineService';

export interface AccountQuarantinePreviewReadiness {
  readonly adminNotificationReady: boolean;
  readonly recoveryThreadReady: boolean;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => canonicalize(item))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

export function buildAccountQuarantinePreviewFingerprint(
  preview: AccountQuarantinePreview,
  readiness: AccountQuarantinePreviewReadiness
): string {
  const lockdown = Object.fromEntries(
    Object.entries(preview.lockdown).filter(([key]) => key !== 'checkedAt')
  );
  const state = canonicalize({
    version: 1,
    admin_notification_ready: readiness.adminNotificationReady,
    case_role_id: preview.caseRoleId,
    enabled: preview.enabled,
    lockdown,
    member_audit: preview.memberAudit,
    recovery_thread_ready: readiness.recoveryThreadReady,
    role_preview: preview.rolePreview,
  });
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}
