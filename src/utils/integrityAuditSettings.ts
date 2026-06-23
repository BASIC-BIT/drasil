export const INTEGRITY_AUDIT_DEFAULT_DAYS = 30;
export const INTEGRITY_AUDIT_MIN_DAYS = 1;
export const INTEGRITY_AUDIT_MAX_DAYS = 365;
export const INTEGRITY_AUDIT_DEFAULT_LIMIT = 50;
export const INTEGRITY_AUDIT_MIN_LIMIT = 1;
export const INTEGRITY_AUDIT_MAX_LIMIT = 250;

export const INTEGRITY_AUDIT_SCOPES = ['all', 'cases', 'case_role', 'queue'] as const;

export type IntegrityAuditScope = (typeof INTEGRITY_AUDIT_SCOPES)[number];

export function normalizeIntegrityAuditScope(
  value: string | null | undefined
): IntegrityAuditScope {
  return INTEGRITY_AUDIT_SCOPES.includes(value as IntegrityAuditScope)
    ? (value as IntegrityAuditScope)
    : 'all';
}

export function clampIntegrityAuditDays(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return INTEGRITY_AUDIT_DEFAULT_DAYS;
  }

  return Math.min(Math.max(value, INTEGRITY_AUDIT_MIN_DAYS), INTEGRITY_AUDIT_MAX_DAYS);
}

export function clampIntegrityAuditLimit(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return INTEGRITY_AUDIT_DEFAULT_LIMIT;
  }

  return Math.min(Math.max(value, INTEGRITY_AUDIT_MIN_LIMIT), INTEGRITY_AUDIT_MAX_LIMIT);
}
