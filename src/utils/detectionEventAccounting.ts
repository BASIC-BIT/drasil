import { AdminActionType } from '../repositories/types';

export const DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY = 'excluded_from_accounting';
export const DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY = 'accounting_exclusion_scope';
export const DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY = 'accounting_excluded_by';
export const DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY = 'accounting_excluded_at';
export const DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY = 'accounting_exclusion_reason';
export const DETECTION_TEST_MODE_METADATA_KEY = 'test_mode';
export const DETECTION_TEST_RUN_ID_METADATA_KEY = 'test_run_id';
export const DRASIL_DETECTION_TEST_MODE_ENV = 'DRASIL_DETECTION_TEST_MODE';
export const DRASIL_DETECTION_TEST_RUN_ID_ENV = 'DRASIL_DETECTION_TEST_RUN_ID';

const DETECTION_TEST_MODE_EXCLUDED_BY = 'system:test-mode';
const DETECTION_TEST_MODE_EXCLUSION_REASON = 'Detection test mode';

interface DetectionAccountingAction {
  action_type: string;
  action_at: Date | string | null;
}

export interface DetectionAccountingStatus {
  excluded: boolean;
  scope?: string;
  reason?: string;
  excludedBy?: string;
  excludedAt?: string;
}

export interface DetectionAccountingInput {
  metadata?: unknown;
  admin_actions?: DetectionAccountingAction[];
}

export function isDetectionEventExcludedFromAccounting(event: DetectionAccountingInput): boolean {
  return getDetectionEventAccountingStatus(event).excluded;
}

export function isDetectionEventMarkedFalsePositive(event: DetectionAccountingInput): boolean {
  const metadata = metadataToRecord(event.metadata);
  const accountingActions = [...(event.admin_actions ?? [])]
    .filter(
      (action) =>
        action.action_type === AdminActionType.FALSE_POSITIVE ||
        action.action_type === AdminActionType.UNDO_OBSERVED_ACTION
    )
    .sort((a, b) => actionTimestamp(b) - actionTimestamp(a));
  const latestAccountingAction = accountingActions.length > 0 ? accountingActions[0] : undefined;

  if (latestAccountingAction?.action_type === AdminActionType.UNDO_OBSERVED_ACTION) {
    return false;
  }

  return (
    latestAccountingAction?.action_type === AdminActionType.FALSE_POSITIVE ||
    metadata.observed_action === AdminActionType.FALSE_POSITIVE
  );
}

export function getDetectionEventAccountingStatus(
  event: DetectionAccountingInput
): DetectionAccountingStatus {
  const metadata = metadataToRecord(event.metadata);
  const accountingActions = [...(event.admin_actions ?? [])]
    .filter(
      (action) =>
        action.action_type === AdminActionType.FALSE_POSITIVE ||
        action.action_type === AdminActionType.UNDO_OBSERVED_ACTION
    )
    .sort((a, b) => actionTimestamp(b) - actionTimestamp(a));
  const latestAccountingAction = accountingActions.length > 0 ? accountingActions[0] : undefined;

  if (latestAccountingAction?.action_type === AdminActionType.UNDO_OBSERVED_ACTION) {
    return { excluded: false };
  }

  if (latestAccountingAction?.action_type === AdminActionType.FALSE_POSITIVE) {
    return {
      excluded: true,
      scope: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY]) ?? 'server',
      reason:
        stringValue(metadata[DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY]) ??
        'Marked false positive',
      excludedBy: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY]),
      excludedAt: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY]),
    };
  }

  const explicitlyExcluded = metadata[DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY];
  if (explicitlyExcluded === true) {
    return {
      excluded: true,
      scope: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY]),
      reason: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY]),
      excludedBy: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY]),
      excludedAt: stringValue(metadata[DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY]),
    };
  }
  if (explicitlyExcluded === false) {
    return { excluded: false };
  }

  if (metadata.observed_action === AdminActionType.FALSE_POSITIVE) {
    return {
      excluded: true,
      scope: 'server',
      reason: 'Marked false positive',
      excludedBy: stringValue(metadata.observed_action_by),
      excludedAt: stringValue(metadata.observed_action_at),
    };
  }

  return { excluded: false };
}

export function createAccountingExclusionMetadata(
  moderatorId: string,
  reason: string,
  scope = 'server'
): Record<string, unknown> {
  return {
    [DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY]: true,
    [DETECTION_ACCOUNTING_EXCLUSION_SCOPE_METADATA_KEY]: scope,
    [DETECTION_ACCOUNTING_EXCLUDED_BY_METADATA_KEY]: moderatorId,
    [DETECTION_ACCOUNTING_EXCLUDED_AT_METADATA_KEY]: new Date().toISOString(),
    [DETECTION_ACCOUNTING_EXCLUSION_REASON_METADATA_KEY]: reason,
  };
}

export function isDetectionTestModeEnabled(): boolean {
  return process.env[DRASIL_DETECTION_TEST_MODE_ENV] === 'true';
}

export function withDetectionTestingMetadata(
  metadata?: Record<string, unknown>,
  scope = 'server'
): Record<string, unknown> | undefined {
  if (!isDetectionTestModeEnabled()) {
    return metadata;
  }

  const testRunId = process.env[DRASIL_DETECTION_TEST_RUN_ID_ENV]?.trim();
  return {
    ...(metadata ?? {}),
    [DETECTION_TEST_MODE_METADATA_KEY]: true,
    ...(testRunId ? { [DETECTION_TEST_RUN_ID_METADATA_KEY]: testRunId } : {}),
    ...createAccountingExclusionMetadata(
      DETECTION_TEST_MODE_EXCLUDED_BY,
      DETECTION_TEST_MODE_EXCLUSION_REASON,
      scope
    ),
  };
}

export function formatDetectionAccountingStatus(event: DetectionAccountingInput): string {
  const status = getDetectionEventAccountingStatus(event);
  if (!status.excluded) {
    return 'counts toward future accounting';
  }

  const scope = status.scope ? `${status.scope} ` : '';
  const reason = status.reason ? ` (${status.reason})` : '';
  return `excluded from ${scope}future accounting${reason}`;
}

function metadataToRecord(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  return { ...metadata } as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function actionTimestamp(action: DetectionAccountingAction): number {
  if (!action.action_at) {
    return 0;
  }

  const timestamp = new Date(action.action_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
