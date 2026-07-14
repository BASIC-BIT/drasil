import type {
  ModerationActionRequestActionType,
  ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';
import { isWebE2eFixtureMode, fixtureTimestampIso } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface ModerationActionRequestSummary {
  readonly id: string;
  readonly actionType: ModerationActionRequestActionType;
  readonly actorSurface: string;
  readonly completedAt: string | null;
  readonly detectionEventId: string | null;
  readonly failedAt: string | null;
  readonly lastError: string | null;
  readonly requestedAt: string;
  readonly reportIntakeId: string | null;
  readonly requestedAction: string | null;
  readonly resultSummary: string | null;
  readonly status: ModerationActionRequestQueueStatus;
  readonly targetUserId: string | null;
  readonly updatedAt: string;
  readonly verificationEventId: string | null;
}

export interface ModerationActionRequestDataAdapter {
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

const operationResultFormatters: Partial<
  Record<ModerationActionRequestActionType, OperationResultFormatter>
> = {
  apply_case_role_lockdown: formatCaseRoleLockdownApplyResult,
  audit_case_role_lockdown: formatCaseRoleLockdownAuditResult,
  clear_moderation_queue: formatClearModerationQueueResult,
  close_resolved_case_threads: formatCloseResolvedThreadsResult,
  complete_setup_verification: formatSetupVerificationResult,
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
  return {
    id: row.id,
    actionType: row.action_type,
    actorSurface: row.actor_surface,
    completedAt: toNullableIsoString(row.completed_at),
    detectionEventId: row.detection_event_id ?? null,
    failedAt: toNullableIsoString(row.failed_at),
    lastError: row.last_error,
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
  public async listRecentRequests(
    guildId: string,
    limit = 8
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
         metadata,
         requested_at,
         report_intake_id::text,
         result,
         status::text as status,
         target_user_id,
         updated_at,
         verification_event_id::text
       from moderation_action_requests
       where server_id = $1
       order by requested_at desc
       limit $2`,
      [guildId, boundedLimit]
    );

    return result.rows.map(parseModerationActionRequestRow);
  }
}

export class FixtureModerationActionRequestDataAdapter implements ModerationActionRequestDataAdapter {
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
}

export function createModerationActionRequestDataAdapter(): ModerationActionRequestDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureModerationActionRequestDataAdapter();
  }

  return new PostgresModerationActionRequestDataAdapter();
}
