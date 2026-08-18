import { inboxModerationActionRequestTypes } from './inboxActionRequestTypes';
import type {
  ModerationActionRequestActionType,
  ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';
import { isWebE2eFixtureMode, fixtureTimestampIso } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface ModerationActionRequestSummary {
  readonly accountQuarantinePreview?: AccountQuarantinePreviewSummary | null;
  readonly id: string;
  readonly actionType: ModerationActionRequestActionType;
  readonly actorSurface: string;
  readonly completedAt: string | null;
  readonly detectionEventId: string | null;
  readonly failedAt: string | null;
  readonly lastError: string | null;
  readonly messageDeletionJobId: string | null;
  readonly requestedAt: string;
  readonly reportIntakeId: string | null;
  readonly requestedAction: string | null;
  readonly resultSummary: string | null;
  readonly status: ModerationActionRequestQueueStatus;
  readonly targetUserId: string | null;
  readonly updatedAt: string;
  readonly verificationEventId: string | null;
}

export interface AccountQuarantineRoleSummary {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly reason: string | null;
}

export interface AccountQuarantinePreviewSummary {
  readonly adminNotificationReady: boolean;
  readonly canContain: boolean;
  readonly caseRoleReady: boolean;
  readonly caseRole: AccountQuarantineRoleSummary | null;
  readonly enabled: boolean;
  readonly lockdownErrorCount: number;
  readonly lockdownIssueCount: number;
  readonly lockdownPlannedActionCount: number;
  readonly memberBypassCount: number;
  readonly plannedRoles: readonly AccountQuarantineRoleSummary[];
  readonly previewedAt: string | null;
  readonly privilegedRoles: readonly AccountQuarantineRoleSummary[];
  readonly recoveryThreadReady: boolean;
  readonly recoveryThreadId: string | null;
  readonly retainedRoles: readonly AccountQuarantineRoleSummary[];
  readonly unremovablePrivilegeReasons: readonly string[];
}

export interface ModerationActionRequestDataAdapter {
  listInboxRequests(
    guildId: string,
    recentLimit?: number
  ): Promise<ModerationActionRequestSummary[]>;
  listCaseRequests(
    guildId: string,
    verificationEventId: string,
    limit?: number
  ): Promise<ModerationActionRequestSummary[]>;
  listRecentRequests(guildId: string, limit?: number): Promise<ModerationActionRequestSummary[]>;
}

interface ModerationActionRequestRow {
  readonly id: string;
  readonly action_type: ModerationActionRequestActionType;
  readonly actor_surface: string;
  readonly completed_at: unknown;
  readonly detection_event_id?: string | null;
  readonly failed_at: unknown;
  readonly last_error: string | null;
  readonly metadata?: unknown;
  readonly message_deletion_job_id?: string | null;
  readonly requested_at: unknown;
  readonly report_intake_id?: string | null;
  readonly result: unknown;
  readonly status: ModerationActionRequestQueueStatus;
  readonly target_user_id: string | null;
  readonly updated_at: unknown;
  readonly verification_event_id?: string | null;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return new Date(value).toISOString();
  }
  return new Date(0).toISOString();
}

function toNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toIsoString(value);
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

interface OperationResultRecord {
  readonly [key: string]: unknown;
}

type OperationResultFormatter = (result: OperationResultRecord) => string | null;

function readString(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readRoleSummaries(value: unknown): AccountQuarantineRoleSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return [];
    }
    const record = item as OperationResultRecord;
    const roleId = readString(record.role_id);
    if (!roleId) {
      return [];
    }
    return [
      {
        roleId,
        roleName: readString(record.role_name),
        reason: readString(record.reason),
      },
    ];
  });
}

function readRoleSummary(value: unknown): AccountQuarantineRoleSummary | null {
  return readRoleSummaries(value ? [value] : [])[0] ?? null;
}

function parseAccountQuarantinePreview(result: unknown): AccountQuarantinePreviewSummary | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }
  const record = result as OperationResultRecord;
  if (record.action_type !== 'preview_account_quarantine') {
    return null;
  }
  return {
    adminNotificationReady: readBoolean(record.admin_notification_ready) ?? false,
    canContain: readBoolean(record.can_contain) ?? false,
    caseRoleReady: readBoolean(record.case_role_ready) ?? false,
    caseRole: readRoleSummary(record.case_role),
    enabled: readBoolean(record.enabled) ?? false,
    lockdownErrorCount: readNumber(record.lockdown_error_count) ?? 0,
    lockdownIssueCount: Array.isArray(record.lockdown_issues) ? record.lockdown_issues.length : 0,
    lockdownPlannedActionCount: readNumber(record.lockdown_planned_actions) ?? 0,
    memberBypassCount: Array.isArray(record.member_bypasses) ? record.member_bypasses.length : 0,
    plannedRoles: readRoleSummaries(record.planned_roles),
    previewedAt: readString(record.previewed_at),
    privilegedRoles: readRoleSummaries(record.privileged_roles),
    recoveryThreadReady: readBoolean(record.recovery_thread_ready) ?? false,
    recoveryThreadId: readString(record.recovery_thread_id),
    retainedRoles: readRoleSummaries(record.retained_roles),
    unremovablePrivilegeReasons: readStringArray(record.unremovable_privilege_reasons),
  };
}

function formatClearModerationQueueResult(result: OperationResultRecord) {
  const removedCount = readNumber(result.removed_count);
  return removedCount === null
    ? null
    : `Removed ${removedCount} queue item${removedCount === 1 ? '' : 's'}.`;
}

function formatQueueSyncResult(result: OperationResultRecord) {
  return result.synced === true ? 'Queue sync completed.' : null;
}

function formatCloseResolvedThreadsResult(result: OperationResultRecord) {
  const execute = readBoolean(result.execute) ?? false;
  const wouldClose = readNumber(result.would_close_threads) ?? 0;
  const closed = readNumber(result.closed_threads) ?? 0;
  const alreadyClosed = readNumber(result.already_closed_threads) ?? 0;
  const missing = readNumber(result.missing_threads) ?? 0;
  const failed = readNumber(result.failed_threads) ?? 0;
  return execute
    ? `Closed ${closed}; already closed ${alreadyClosed}; missing ${missing}; failed ${failed}.`
    : `Dry run found ${wouldClose} closable; already closed ${alreadyClosed}; missing ${missing}; failed ${failed}.`;
}

function formatCaseRoleLockdownAuditResult(result: OperationResultRecord) {
  const errors = readNumber(result.error_count) ?? 0;
  const warnings = readNumber(result.warning_count) ?? 0;
  const plannedWrites = readNumber(result.planned_writes) ?? 0;
  return `Audit found ${errors} errors, ${warnings} warnings, and ${plannedWrites} planned write${plannedWrites === 1 ? '' : 's'}.`;
}

function formatCaseRoleLockdownApplyResult(result: OperationResultRecord) {
  const appliedWrites = readNumber(result.applied_writes) ?? 0;
  const plannedWrites = readNumber(result.planned_writes) ?? 0;
  const errors = readNumber(result.error_count) ?? 0;
  const warnings = readNumber(result.warning_count) ?? 0;
  const unsynced = readNumber(result.unsynced_allowed_channels) ?? 0;
  return `Applied ${appliedWrites} writes; remaining ${plannedWrites}; unsynced ${unsynced}; errors ${errors}; warnings ${warnings}.`;
}

function formatRoleIntakeResult(result: OperationResultRecord) {
  const execute = readBoolean(result.execute) ?? false;
  const roleName = readString(result.role_name) ?? 'role';
  const processed = readNumber(result.processed) ?? 0;
  const eligible = readNumber(result.eligible_members) ?? 0;
  const opened = readNumber(result.opened) ?? 0;
  const skippedActive = readNumber(result.skipped_active_cases) ?? 0;
  const failed = readNumber(result.failed) ?? 0;
  return execute
    ? `Executed ${roleName}: opened ${opened}; failed ${failed}; skipped active ${skippedActive}.`
    : `Dry run ${roleName}: selected ${processed} of ${eligible}; skipped active ${skippedActive}; failed ${failed}.`;
}

function formatReportInstructionsResult(result: OperationResultRecord) {
  const action = readString(result.action) ?? 'updated';
  const channelId = readString(result.channel_id);
  return channelId
    ? `Report instructions ${action} in ${channelId}.`
    : `Report instructions ${action}.`;
}

function formatSetupVerificationResult(result: OperationResultRecord) {
  const verificationAction = readString(result.verification_channel_action) ?? 'configured';
  const reportError = readString(result.report_instructions_error)
    ? '; report instructions need attention'
    : '';
  return `Core setup saved; verification channel ${verificationAction}${reportError}.`;
}

function formatMessageCleanupResult(result: OperationResultRecord) {
  const coverage = readString(result.coverage);
  const candidates = readNumber(result.candidate_count);
  if (coverage && candidates !== null) {
    return `Preview found ${candidates} candidate message${candidates === 1 ? '' : 's'} with ${coverage} coverage.`;
  }

  const deleted = readNumber(result.deleted_count) ?? 0;
  const preserved = readNumber(result.preserved_count) ?? 0;
  const changed = readNumber(result.changed_since_preview_count) ?? 0;
  const failed =
    (readNumber(result.evidence_failed_count) ?? 0) +
    (readNumber(result.delete_failed_count) ?? 0) +
    (readNumber(result.permission_denied_count) ?? 0);
  return `Preserved ${preserved}; deleted ${deleted}; changed ${changed}; failed ${failed}.`;
}

function formatAccountQuarantinePreviewResult(result: OperationResultRecord) {
  const planned = Array.isArray(result.planned_roles) ? result.planned_roles.length : 0;
  const retained = Array.isArray(result.retained_roles) ? result.retained_roles.length : 0;
  const bypasses = Array.isArray(result.member_bypasses) ? result.member_bypasses.length : 0;
  return `Live preview: remove ${planned} role${planned === 1 ? '' : 's'}; retain ${retained}; bypasses ${bypasses}.`;
}

function formatAccountQuarantineResult(result: OperationResultRecord) {
  return result.parked === true
    ? 'Account quarantined and case parked.'
    : 'Containment incomplete; case remains in review.';
}

const operationResultFormatters: Partial<
  Record<ModerationActionRequestActionType, OperationResultFormatter>
> = {
  apply_case_role_lockdown: formatCaseRoleLockdownApplyResult,
  audit_case_role_lockdown: formatCaseRoleLockdownAuditResult,
  clear_moderation_queue: formatClearModerationQueueResult,
  close_resolved_case_threads: formatCloseResolvedThreadsResult,
  complete_setup_verification: formatSetupVerificationResult,
  preview_case_message_deletion: formatMessageCleanupResult,
  execute_case_message_deletion: formatMessageCleanupResult,
  ban_case_user_with_message_cleanup: formatMessageCleanupResult,
  preview_account_quarantine: formatAccountQuarantinePreviewResult,
  quarantine_compromised_account: formatAccountQuarantineResult,
  intake_role_members: formatRoleIntakeResult,
  sync_moderation_queue: formatQueueSyncResult,
  upsert_report_instructions: formatReportInstructionsResult,
};

function formatOperationResult(result: OperationResultRecord): string | null {
  const actionType = typeof result.action_type === 'string' ? result.action_type : null;
  const formatter = actionType
    ? operationResultFormatters[actionType as ModerationActionRequestActionType]
    : undefined;
  return formatter?.(result) ?? null;
}

function buildResultSummary(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return null;
  }

  return formatOperationResult(result as OperationResultRecord);
}

export function parseModerationActionRequestRow(
  row: ModerationActionRequestRow
): ModerationActionRequestSummary {
  const accountQuarantinePreview = parseAccountQuarantinePreview(row.result);
  return {
    ...(accountQuarantinePreview ? { accountQuarantinePreview } : {}),
    id: row.id,
    actionType: row.action_type,
    actorSurface: row.actor_surface,
    completedAt: toNullableIsoString(row.completed_at),
    detectionEventId: row.detection_event_id ?? null,
    failedAt: toNullableIsoString(row.failed_at),
    lastError: row.last_error,
    messageDeletionJobId: row.message_deletion_job_id ?? null,
    requestedAt: toIsoString(row.requested_at),
    reportIntakeId: row.report_intake_id ?? null,
    requestedAction:
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (readString((row.metadata as OperationResultRecord).case_action) ??
          readString((row.metadata as OperationResultRecord).inbox_action))
        : null,
    resultSummary: buildResultSummary(row.result),
    status: row.status,
    targetUserId: row.target_user_id,
    updatedAt: toIsoString(row.updated_at),
    verificationEventId: row.verification_event_id ?? null,
  };
}

export class PostgresModerationActionRequestDataAdapter implements ModerationActionRequestDataAdapter {
  public async listInboxRequests(
    guildId: string,
    recentLimit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    return this.listRequests(guildId, recentLimit, true);
  }

  public async listRecentRequests(
    guildId: string,
    limit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    return this.listRequests(guildId, limit, false);
  }

  public async listCaseRequests(
    guildId: string,
    verificationEventId: string,
    limit = 10
  ): Promise<ModerationActionRequestSummary[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 25));
    const result = await getPostgresPool().query<ModerationActionRequestRow>(
      `select
         id::text,
         action_type::text as action_type,
         actor_surface,
         completed_at,
         detection_event_id::text,
         failed_at,
         last_error,
         message_deletion_job_id::text,
         metadata,
         requested_at,
         report_intake_id::text,
         result,
         status::text as status,
         target_user_id,
         updated_at,
         verification_event_id::text
       from moderation_action_requests
       where server_id = $1 and verification_event_id = $2::uuid
       order by requested_at desc
       limit $3`,
      [guildId, verificationEventId, boundedLimit]
    );
    return result.rows.map(parseModerationActionRequestRow);
  }

  private async listRequests(
    guildId: string,
    limit: number,
    includeAllActive: boolean
  ): Promise<ModerationActionRequestSummary[]> {
    const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 25));
    const result = await getPostgresPool().query<ModerationActionRequestRow>(
      `with selected_request_ids as (
         select id
         from moderation_action_requests
         where server_id = $1
           and (not $3::boolean or action_type = any($4::moderation_action_request_type[]))
         order by case when $3::boolean then updated_at else requested_at end desc
         limit $2
       ), inbox_request_ids as (
         select id from selected_request_ids
         union
         select id
         from moderation_action_requests
         where $3::boolean
           and server_id = $1
           and action_type = any($4::moderation_action_request_type[])
           and status in ('queued', 'processing')
       )
       select
         requests.id::text,
         requests.action_type::text as action_type,
         requests.actor_surface,
         requests.completed_at,
         requests.detection_event_id::text,
         requests.failed_at,
         requests.last_error,
         requests.message_deletion_job_id::text,
         requests.metadata,
         requests.requested_at,
         requests.report_intake_id::text,
         requests.result,
         requests.status::text as status,
         requests.target_user_id,
         requests.updated_at,
         requests.verification_event_id::text
       from moderation_action_requests requests
       join inbox_request_ids selected on selected.id = requests.id
       order by requests.requested_at desc`,
      [guildId, boundedLimit, includeAllActive, inboxModerationActionRequestTypes]
    );

    return result.rows.map(parseModerationActionRequestRow);
  }
}

export class FixtureModerationActionRequestDataAdapter implements ModerationActionRequestDataAdapter {
  public async listInboxRequests(
    guildId: string,
    recentLimit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    return this.listRecentRequests(guildId, recentLimit);
  }

  public async listRecentRequests(
    _guildId: string,
    _limit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    return [
      {
        id: 'fixture-action-request-1',
        actionType: 'sync_moderation_queue',
        actorSurface: 'web',
        completedAt: fixtureTimestampIso,
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: fixtureTimestampIso,
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Queue sync completed.',
        status: 'completed',
        targetUserId: null,
        updatedAt: fixtureTimestampIso,
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-2',
        actionType: 'refresh_case_notification',
        actorSurface: 'web',
        completedAt: '2026-06-08T01:11:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T01:10:02.000Z',
        reportIntakeId: null,
        requestedAction: 'refresh_notification',
        resultSummary: null,
        status: 'completed',
        targetUserId: 'user-100',
        updatedAt: '2026-06-08T01:11:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-3',
        actionType: 'close_resolved_case_threads',
        actorSurface: 'web',
        completedAt: '2026-06-08T01:05:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T01:04:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Dry run found 4 closable; already closed 2; missing 1; failed 0.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T01:05:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-4',
        actionType: 'audit_case_role_lockdown',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:59:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:58:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Audit found 0 errors, 2 warnings, and 3 planned writes.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:59:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-5',
        actionType: 'intake_role_members',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:51:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:50:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Dry run Manual Intake: selected 8 of 10; skipped active 1; failed 0.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:51:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-6',
        actionType: 'complete_setup_verification',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:48:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:47:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Core setup saved; verification channel configured.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:48:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-7',
        actionType: 'upsert_report_instructions',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:46:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:45:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Report instructions updated in report-channel-1.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:46:02.000Z',
        verificationEventId: null,
      },
    ];
  }

  public async listCaseRequests(
    guildId: string,
    verificationEventId: string,
    limit = 10
  ): Promise<ModerationActionRequestSummary[]> {
    return (await this.listRecentRequests(guildId, limit)).filter(
      (request) => request.verificationEventId === verificationEventId
    );
  }
}

export function createModerationActionRequestDataAdapter(): ModerationActionRequestDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureModerationActionRequestDataAdapter();
  }

  return new PostgresModerationActionRequestDataAdapter();
}
