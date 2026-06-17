export const VERIFICATION_ACTION_FAILURES_METADATA_KEY = 'action_failures';

export type VerificationActionFailureKind =
  | 'case_role'
  | 'restrict'
  | 'thread'
  | 'private_evidence_thread'
  | 'role_quarantine';

export interface VerificationActionFailure {
  action: VerificationActionFailureKind;
  message: string;
  at: string;
}

function metadataToRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return { ...(metadata as Record<string, unknown>) };
}

function isVerificationActionFailureKind(value: unknown): value is VerificationActionFailureKind {
  return (
    value === 'case_role' ||
    value === 'restrict' ||
    value === 'thread' ||
    value === 'private_evidence_thread' ||
    value === 'role_quarantine'
  );
}

function isVerificationActionFailure(value: unknown): value is VerificationActionFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    isVerificationActionFailureKind(candidate.action) &&
    typeof candidate.message === 'string' &&
    typeof candidate.at === 'string'
  );
}

export function getVerificationActionFailures(metadata: unknown): VerificationActionFailure[] {
  const record = metadataToRecord(metadata);
  const failures = record[VERIFICATION_ACTION_FAILURES_METADATA_KEY];

  if (!Array.isArray(failures)) {
    return [];
  }

  return failures.filter(isVerificationActionFailure);
}

export function appendVerificationActionFailure(
  metadata: unknown,
  failure: VerificationActionFailure,
  maxFailures = 5
): Record<string, unknown> {
  const record = metadataToRecord(metadata);
  const failures = [...getVerificationActionFailures(metadata), failure].slice(-maxFailures);

  return {
    ...record,
    [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: failures,
  };
}

export function clearVerificationActionFailures(
  metadata: unknown,
  actions: readonly VerificationActionFailureKind[]
): Record<string, unknown> {
  const record = metadataToRecord(metadata);
  const actionsToClear = new Set(actions);
  const failures = getVerificationActionFailures(metadata).filter(
    (failure) => !actionsToClear.has(failure.action)
  );

  if (failures.length === 0) {
    delete record[VERIFICATION_ACTION_FAILURES_METADATA_KEY];
    return record;
  }

  return {
    ...record,
    [VERIFICATION_ACTION_FAILURES_METADATA_KEY]: failures,
  };
}
