import {
  MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH,
  MESSAGE_CLEANUP_LATEST_JOB_LIMIT,
  getMessageCleanupExecutionEligibility,
  messageCleanupCaseStatusSchema,
  messageCleanupCaseWorkspaceSchema,
  messageCleanupJobDetailSchema,
  messageCleanupJobSummarySchema,
  messageCleanupItemSchema,
  type MessageCleanupCaseWorkspace,
  type MessageCleanupCoverage,
  type MessageCleanupItem,
  type MessageCleanupJobDetail,
  type MessageCleanupJobMode,
  type MessageCleanupJobStatus,
  type MessageCleanupJobSummary,
  type MessageCleanupScope,
  type MessageCleanupWorkspaceBlockReason,
} from '@drasil/contracts';
import type { QueryResultRow } from 'pg';
import { discordMessageUrl } from './discordUrls';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from './messageCleanupFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface MessageCleanupDataAdapter {
  getCaseWorkspace(
    guildId: string,
    verificationEventId: string
  ): Promise<MessageCleanupCaseWorkspace | null>;
  listCaseWorkspaces(
    guildId: string,
    verificationEventIds: readonly string[]
  ): Promise<MessageCleanupCaseWorkspace[]>;
  listLatestJobs(
    guildId: string,
    verificationEventId: string,
    limit?: number
  ): Promise<MessageCleanupJobSummary[]>;
  getJobDetail(
    guildId: string,
    verificationEventId: string,
    jobId: string
  ): Promise<MessageCleanupJobDetail | null>;
}

export interface MessageCleanupQueryClient {
  query<Row extends QueryResultRow>(text: string, values: unknown[]): Promise<{ rows: Row[] }>;
}

export interface MessageCleanupCaseRow extends QueryResultRow {
  id: string;
  server_id: string;
  user_id: string | null;
  status: string;
  private_evidence_thread_id: string | null;
}

export interface MessageCleanupJobRow extends QueryResultRow {
  id: string;
  server_id: string;
  user_id: string;
  verification_event_id: string;
  requested_by: string;
  actor_surface: string;
  mode: MessageCleanupJobMode;
  scope: MessageCleanupScope;
  status: MessageCleanupJobStatus;
  coverage: MessageCleanupCoverage | null;
  ban_status: string;
  case_finalization_status: string;
  reason: string;
  evidence_thread_id: string;
  requested_window_start: unknown;
  requested_window_end: unknown;
  previewed_at: unknown;
  started_at: unknown;
  completed_at: unknown;
  failed_at: unknown;
  created_at: unknown;
  updated_at: unknown;
  candidate_count: unknown;
  preserved_count: unknown;
  deleted_count: unknown;
  already_missing_count: unknown;
  changed_count: unknown;
  evidence_failed_count: unknown;
  delete_failed_count: unknown;
  permission_denied_count: unknown;
  last_error: string | null;
}

export interface MessageCleanupItemRow extends QueryResultRow {
  id: string;
  message_id: string;
  channel_id: string;
  author_id: string;
  message_created_at: unknown;
  message_edited_at: unknown;
  content_preview: unknown;
  attachment_count: unknown;
  discovery_source: string;
  bulk_delete_eligible: boolean;
  evidence_status: string;
  status: string;
  evidence_message_id: string | null;
  attempted_at: unknown;
  evidence_preserved_at: unknown;
  deleted_at: unknown;
  completed_at: unknown;
  failure_reason: string | null;
}

const safeDiscordPathPartPattern = /^[A-Za-z0-9_-]+$/;

function requireScopeValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }
  return normalized;
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }
  throw new Error('Message cleanup row contains an invalid timestamp.');
}

function toNullableIsoString(value: unknown): string | null {
  return value === null || value === undefined ? null : toIsoString(value);
}

function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toLatestJobLimit(value: number): number {
  if (!Number.isFinite(value)) {
    return MESSAGE_CLEANUP_LATEST_JOB_LIMIT;
  }
  return Math.min(MESSAGE_CLEANUP_LATEST_JOB_LIMIT, Math.max(1, Math.trunc(value)));
}

function safeDiscordUrl(
  guildId: string,
  channelId: string | null,
  messageId?: string | null
): string | null {
  if (
    !channelId ||
    !safeDiscordPathPartPattern.test(guildId) ||
    !safeDiscordPathPartPattern.test(channelId) ||
    (messageId !== null && messageId !== undefined && !safeDiscordPathPartPattern.test(messageId))
  ) {
    return null;
  }
  return discordMessageUrl(guildId, channelId, messageId);
}

export function toBoundedSafeMessageCleanupPreview(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\b(https?):\/\//gi, '$1[:]//')
    .replace(/\bwww\./gi, 'www[.]')
    .replace(/\bdiscord\.gg\//gi, 'discord[.]gg/')
    .slice(0, MESSAGE_CLEANUP_CONTENT_PREVIEW_MAX_LENGTH);
}

function resolveWorkspaceBlockReason(
  row: MessageCleanupCaseRow,
  evidenceThreadUrl: string | null
): MessageCleanupWorkspaceBlockReason | null {
  if (row.status !== 'pending') {
    return 'case_not_pending';
  }
  if (!row.user_id) {
    return 'missing_target_user';
  }
  if (!evidenceThreadUrl) {
    return 'missing_evidence_thread';
  }
  return null;
}

export function parseMessageCleanupJobRow(row: MessageCleanupJobRow): MessageCleanupJobSummary {
  const candidateCount = toCount(row.candidate_count);
  return messageCleanupJobSummarySchema.parse({
    id: row.id,
    guildId: row.server_id,
    verificationEventId: row.verification_event_id,
    targetUserId: row.user_id,
    requestedBy: row.requested_by,
    actorSurface: row.actor_surface,
    mode: row.mode,
    scope: row.scope,
    status: row.status,
    coverage: row.coverage,
    banStatus: row.ban_status,
    caseFinalizationStatus: row.case_finalization_status,
    reason: row.reason,
    evidenceThreadUrl: safeDiscordUrl(row.server_id, row.evidence_thread_id),
    requestedWindowStart: toNullableIsoString(row.requested_window_start),
    requestedWindowEnd: toNullableIsoString(row.requested_window_end),
    previewedAt: toNullableIsoString(row.previewed_at),
    startedAt: toNullableIsoString(row.started_at),
    completedAt: toNullableIsoString(row.completed_at),
    failedAt: toNullableIsoString(row.failed_at),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    lastError: row.last_error,
    outcomes: {
      candidateCount,
      preservedCount: toCount(row.preserved_count),
      deletedCount: toCount(row.deleted_count),
      alreadyMissingCount: toCount(row.already_missing_count),
      changedSincePreviewCount: toCount(row.changed_count),
      evidenceFailedCount: toCount(row.evidence_failed_count),
      deleteFailedCount: toCount(row.delete_failed_count),
      permissionDeniedCount: toCount(row.permission_denied_count),
    },
    execution: getMessageCleanupExecutionEligibility({
      status: row.status,
      coverage: row.coverage,
      scope: row.scope,
      candidateCount,
    }),
  });
}

export function parseMessageCleanupItemRow(
  guildId: string,
  evidenceThreadId: string,
  row: MessageCleanupItemRow
): MessageCleanupItem {
  return messageCleanupItemSchema.parse({
    id: row.id,
    messageId: row.message_id,
    channelId: row.channel_id,
    authorId: row.author_id,
    messageCreatedAt: toIsoString(row.message_created_at),
    messageEditedAt: toNullableIsoString(row.message_edited_at),
    contentPreview: toBoundedSafeMessageCleanupPreview(row.content_preview),
    attachmentCount: toCount(row.attachment_count),
    discoverySource: row.discovery_source,
    bulkDeleteEligible: row.bulk_delete_eligible,
    evidenceStatus: row.evidence_status,
    status: row.status,
    sourceMessageUrl: safeDiscordUrl(guildId, row.channel_id, row.message_id),
    evidenceMessageUrl: row.evidence_message_id
      ? safeDiscordUrl(guildId, evidenceThreadId, row.evidence_message_id)
      : null,
    attemptedAt: toNullableIsoString(row.attempted_at),
    evidencePreservedAt: toNullableIsoString(row.evidence_preserved_at),
    deletedAt: toNullableIsoString(row.deleted_at),
    completedAt: toNullableIsoString(row.completed_at),
    failureReason: row.failure_reason,
  });
}

export function parseMessageCleanupCaseWorkspace(
  row: MessageCleanupCaseRow,
  latestJobs: readonly MessageCleanupJobSummary[]
): MessageCleanupCaseWorkspace {
  const caseStatus = messageCleanupCaseStatusSchema.parse(row.status);
  const evidenceThreadUrl = safeDiscordUrl(row.server_id, row.private_evidence_thread_id);
  const blockedReason = resolveWorkspaceBlockReason(row, evidenceThreadUrl);

  return messageCleanupCaseWorkspaceSchema.parse({
    guildId: row.server_id,
    verificationEventId: row.id,
    targetUserId: row.user_id,
    caseStatus,
    evidenceThreadUrl,
    canPreview: blockedReason === null,
    blockedReason,
    latestJobs,
  });
}

export class PostgresMessageCleanupDataAdapter implements MessageCleanupDataAdapter {
  public constructor(
    private readonly database: MessageCleanupQueryClient = getPostgresPool() as MessageCleanupQueryClient
  ) {}

  public async getCaseWorkspace(
    guildId: string,
    verificationEventId: string
  ): Promise<MessageCleanupCaseWorkspace | null> {
    const workspaces = await this.listCaseWorkspaces(guildId, [verificationEventId]);
    return workspaces[0] ?? null;
  }

  public async listCaseWorkspaces(
    guildId: string,
    verificationEventIds: readonly string[]
  ): Promise<MessageCleanupCaseWorkspace[]> {
    const scopedGuildId = requireScopeValue(guildId, 'guildId');
    const scopedVerificationEventIds = [
      ...new Set(verificationEventIds.map((id) => requireScopeValue(id, 'verificationEventId'))),
    ];
    if (scopedVerificationEventIds.length === 0) {
      return [];
    }

    const [caseResult, jobResult] = await Promise.all([
      this.database.query<MessageCleanupCaseRow>(
        `select id, server_id, user_id, status, private_evidence_thread_id
         from verification_events
         where server_id = $1 and id = any($2::uuid[])`,
        [scopedGuildId, scopedVerificationEventIds]
      ),
      this.database.query<MessageCleanupJobRow>(
        `select ranked.*
         from (
           select
             jobs.*,
             row_number() over (
               partition by jobs.verification_event_id
               order by jobs.created_at desc, jobs.id desc
             ) as case_job_rank
           from message_deletion_jobs jobs
           where jobs.server_id = $1 and jobs.verification_event_id = any($2::uuid[])
         ) ranked
         where ranked.case_job_rank <= $3
         order by ranked.verification_event_id, ranked.created_at desc, ranked.id desc`,
        [scopedGuildId, scopedVerificationEventIds, MESSAGE_CLEANUP_LATEST_JOB_LIMIT]
      ),
    ]);
    const jobsByCase = new Map<string, MessageCleanupJobSummary[]>();
    for (const row of jobResult.rows) {
      const jobs = jobsByCase.get(row.verification_event_id) ?? [];
      jobs.push(parseMessageCleanupJobRow(row));
      jobsByCase.set(row.verification_event_id, jobs);
    }
    const casesById = new Map(caseResult.rows.map((row) => [row.id, row]));
    return scopedVerificationEventIds.flatMap((id) => {
      const row = casesById.get(id);
      return row ? [parseMessageCleanupCaseWorkspace(row, jobsByCase.get(id) ?? [])] : [];
    });
  }

  public async listLatestJobs(
    guildId: string,
    verificationEventId: string,
    limit = MESSAGE_CLEANUP_LATEST_JOB_LIMIT
  ): Promise<MessageCleanupJobSummary[]> {
    const scopedGuildId = requireScopeValue(guildId, 'guildId');
    const scopedVerificationEventId = requireScopeValue(verificationEventId, 'verificationEventId');
    const boundedLimit = toLatestJobLimit(limit);
    const result = await this.database.query<MessageCleanupJobRow>(
      `select *
       from message_deletion_jobs
       where server_id = $1 and verification_event_id = $2::uuid
       order by created_at desc, id desc
       limit $3`,
      [scopedGuildId, scopedVerificationEventId, boundedLimit]
    );
    return result.rows.map(parseMessageCleanupJobRow);
  }

  public async getJobDetail(
    guildId: string,
    verificationEventId: string,
    jobId: string
  ): Promise<MessageCleanupJobDetail | null> {
    const scopedGuildId = requireScopeValue(guildId, 'guildId');
    const scopedVerificationEventId = requireScopeValue(verificationEventId, 'verificationEventId');
    const scopedJobId = requireScopeValue(jobId, 'jobId');
    const jobResult = await this.database.query<MessageCleanupJobRow>(
      `select *
       from message_deletion_jobs
       where server_id = $1 and verification_event_id = $2::uuid and id = $3::uuid
       limit 1`,
      [scopedGuildId, scopedVerificationEventId, scopedJobId]
    );
    const jobRow = jobResult.rows[0];
    if (!jobRow) {
      return null;
    }

    const itemResult = await this.database.query<MessageCleanupItemRow>(
      `select i.*
       from message_deletion_items i
       inner join message_deletion_jobs j on j.id = i.job_id
       where j.server_id = $1 and j.verification_event_id = $2::uuid and i.job_id = $3::uuid
       order by i.message_created_at asc, i.id asc`,
      [scopedGuildId, scopedVerificationEventId, scopedJobId]
    );
    return messageCleanupJobDetailSchema.parse({
      ...parseMessageCleanupJobRow(jobRow),
      items: itemResult.rows.map((row) =>
        parseMessageCleanupItemRow(jobRow.server_id, jobRow.evidence_thread_id, row)
      ),
    });
  }
}

export class FixtureMessageCleanupDataAdapter implements MessageCleanupDataAdapter {
  public async getCaseWorkspace(
    guildId: string,
    verificationEventId: string
  ): Promise<MessageCleanupCaseWorkspace | null> {
    const workspace = fixtureMessageCleanupCaseWorkspaces.find(
      (candidate) =>
        candidate.guildId === guildId && candidate.verificationEventId === verificationEventId
    );
    return workspace ? messageCleanupCaseWorkspaceSchema.parse(workspace) : null;
  }

  public async listCaseWorkspaces(
    guildId: string,
    verificationEventIds: readonly string[]
  ): Promise<MessageCleanupCaseWorkspace[]> {
    const caseIds = new Set(verificationEventIds);
    return fixtureMessageCleanupCaseWorkspaces
      .filter(
        (workspace) => workspace.guildId === guildId && caseIds.has(workspace.verificationEventId)
      )
      .map((workspace) => messageCleanupCaseWorkspaceSchema.parse(workspace));
  }

  public async listLatestJobs(
    guildId: string,
    verificationEventId: string,
    limit = MESSAGE_CLEANUP_LATEST_JOB_LIMIT
  ): Promise<MessageCleanupJobSummary[]> {
    return fixtureMessageCleanupJobDetails
      .filter((job) => job.guildId === guildId && job.verificationEventId === verificationEventId)
      .slice(0, toLatestJobLimit(limit))
      .map((job) => messageCleanupJobSummarySchema.parse(job));
  }

  public async getJobDetail(
    guildId: string,
    verificationEventId: string,
    jobId: string
  ): Promise<MessageCleanupJobDetail | null> {
    const detail = fixtureMessageCleanupJobDetails.find(
      (candidate) =>
        candidate.guildId === guildId &&
        candidate.verificationEventId === verificationEventId &&
        candidate.id === jobId
    );
    return detail ? messageCleanupJobDetailSchema.parse(detail) : null;
  }
}

export function createMessageCleanupDataAdapter(): MessageCleanupDataAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureMessageCleanupDataAdapter();
  }
  return new PostgresMessageCleanupDataAdapter();
}
