import { ActionDeniedError } from '../results';
import { canonicalDigest, setupFingerprintState } from '../delegation/intents';
import {
  setupServerRecordSchema,
  normalizeOptionalId,
  getEffectiveCaptchaMethod,
  captchaMethodSchema,
  type SetupServerRecord,
} from './settings';
import type { SetupPersistenceChange } from './ports';

export interface SetupWritePrecondition {
  readonly approvedState: SetupServerRecord;
}
export interface SetupStoredChange {
  readonly captchaReadiness?: { readonly turnstile: boolean; readonly discord_image: boolean };
  readonly normalizeHeuristicKeywords?: true;
  readonly lockdownAllowlist?: {
    readonly operation: 'add' | 'remove';
    readonly targetKind: 'channel' | 'category';
    readonly targetId: string;
  };
  readonly columns?: Partial<
    Pick<
      SetupServerRecord,
      | 'case_role_id'
      | 'admin_channel_id'
      | 'verification_channel_id'
      | 'admin_notification_role_id'
      | 'heuristic_message_threshold'
      | 'heuristic_message_timeframe_seconds'
      | 'heuristic_suspicious_keywords'
      | 'is_active'
      | 'updated_by'
    >
  >;
  readonly settings?: Readonly<Record<string, unknown>>;
  readonly resetSettings?: SetupPersistenceChange['resetSettings'];
}
export const setupWorkflowSettings = [
  'verification_channel_permission_sync',
  'report_instructions_message_channel_id',
  'report_instructions_message_id',
  'report_instructions_cleanup_channel_id',
  'report_instructions_cleanup_message_id',
  'report_instructions_pending_publication',
] as const;
export function setupApprovedState(record: SetupServerRecord): unknown {
  return {
    editable: setupFingerprintState(record),
    workflow: Object.fromEntries(setupWorkflowSettings.map((key) => [key, record.settings[key]])),
  };
}
export function parseSetupStoredRecord(row: Record<string, unknown>): SetupServerRecord {
  const settings =
    row.settings && typeof row.settings === 'object'
      ? (row.settings as Record<string, unknown>)
      : {};
  return setupServerRecordSchema.parse({
    ...row,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null),
    settings: {
      ...settings,
      ...(settings.role_quarantine_mode === 'audit_only' ? { role_quarantine_mode: 'off' } : {}),
    },
    is_active: row.is_active ?? true,
  });
}
export function setupStateMatches(
  current: SetupServerRecord,
  precondition: SetupWritePrecondition
): boolean {
  return (
    canonicalDigest(setupApprovedState(current)) ===
    canonicalDigest(setupApprovedState(parseSetupStoredRecord(precondition.approvedState)))
  );
}
export function setupStoredChange(change: SetupPersistenceChange): SetupStoredChange {
  const c = change.columns;
  return {
    settings: change.settings,
    resetSettings: change.resetSettings,
    columns: c
      ? {
          case_role_id: normalizeOptionalId(c.caseRoleId),
          admin_channel_id: normalizeOptionalId(c.adminChannelId),
          verification_channel_id: normalizeOptionalId(c.verificationChannelId),
          admin_notification_role_id: normalizeOptionalId(c.adminNotificationRoleId),
          heuristic_message_threshold: c.heuristicMessageThreshold,
          heuristic_message_timeframe_seconds: c.heuristicMessageTimeframeSeconds,
          heuristic_suspicious_keywords: c.heuristicSuspiciousKeywords,
        }
      : undefined,
  };
}

export function normalizeHeuristicKeywords(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}
function materializeCaptchaSettings(
  current: SetupServerRecord,
  change: SetupStoredChange
): Record<string, unknown> {
  const settings = { ...change.settings };
  if ('captcha_method_revision' in settings) throw new Error('CAPTCHA method revision is private');
  if ('captcha_method' in settings) captchaMethodSchema.parse(settings.captcha_method);
  if ('captcha_method' in settings || 'captcha_mode' in settings) {
    const previousMethod = getEffectiveCaptchaMethod(current.settings);
    const method = getEffectiveCaptchaMethod({ ...current.settings, ...settings });
    settings.captcha_method = method;
    if (
      'captcha_method' in (change.settings ?? {}) &&
      method !== 'none' &&
      (previousMethod === 'none' ||
        (previousMethod !== method &&
          !['manual', 'suspicious_join'].includes(String(current.settings.captcha_mode)))) &&
      settings.captcha_mode !== 'suspicious_join'
    ) {
      // A hidden retained preference must not reactivate automatic issuance.
      settings.captcha_mode = 'manual';
    }
    if (
      change.captchaReadiness &&
      method !== 'none' &&
      ('captcha_method' in (change.settings ?? {}) || settings.captcha_mode !== 'off') &&
      !change.captchaReadiness[method]
    )
      throw new ActionDeniedError('policy_disabled');
  }
  return settings;
}

/** Materialize only semantic edits that must use the locked current row, never a cached read. */
export function materializeSetupStoredChange(
  current: SetupServerRecord,
  change: SetupStoredChange
): SetupStoredChange {
  const columns = { ...change.columns };
  const settings = materializeCaptchaSettings(current, change);
  if (change.normalizeHeuristicKeywords)
    columns.heuristic_suspicious_keywords = normalizeHeuristicKeywords(
      columns.heuristic_suspicious_keywords ?? current.heuristic_suspicious_keywords
    );
  if (change.lockdownAllowlist) {
    const edit = change.lockdownAllowlist;
    const key =
      edit.targetKind === 'channel'
        ? 'case_role_lockdown_allowed_channel_ids'
        : 'case_role_lockdown_allowed_category_ids';
    const ids = new Set(current.settings[key] ?? []);
    if (edit.operation === 'add') ids.add(edit.targetId);
    else ids.delete(edit.targetId);
    settings[key] = [...ids];
  }
  return { columns, settings, resetSettings: change.resetSettings };
}
