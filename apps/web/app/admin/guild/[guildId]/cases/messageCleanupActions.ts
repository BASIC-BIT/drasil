'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  MESSAGE_CLEANUP_REASON_MAX_LENGTH,
  getMessageCleanupExecutionEligibility,
  isMessageCleanupFinalizationRetry,
  messageCleanupJobModeSchema,
  messageCleanupScopeSchema,
  type MessageCleanupBanStatus,
  type MessageCleanupCaseFinalizationStatus,
  type MessageCleanupCoverage,
  type MessageCleanupJobMode,
  type MessageCleanupJobStatus,
  type MessageCleanupScope,
} from '@drasil/contracts';
import type { PoolClient, QueryResultRow } from 'pg';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import {
  failedInboxActionState,
  queuedInboxActionState,
  type InboxActionState,
} from '@/lib/inboxActionState';
import type {
  ModerationActionRequestActionType,
  ModerationActionRequestQueueStatus,
  ModerationActionRequestReceipt,
} from '@/lib/moderationActionRequestQueue';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter, getPostgresPool } from '@/lib/setupDataAdapter';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ACTOR_SURFACE = 'web_case';

interface CleanupCaseRow extends QueryResultRow {
  id: string;
  server_id: string;
  user_id: string | null;
  detection_event_id: string | null;
  private_evidence_thread_id: string | null;
  status: string;
}

interface CleanupJobRow extends QueryResultRow {
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
  reason: string;
  evidence_thread_id: string;
  candidate_count: number;
  ban_status: MessageCleanupBanStatus;
  case_finalization_status: MessageCleanupCaseFinalizationStatus;
}

interface CleanupRequestRow extends QueryResultRow {
  id: string;
  action_type: ModerationActionRequestActionType;
  actor_id: string;
  message_deletion_job_id: string;
  server_id: string;
  status: ModerationActionRequestQueueStatus;
  verification_event_id: string;
}

interface CleanupFormValues {
  idempotencyToken: string;
  mode: MessageCleanupJobMode;
  reason: string;
  scope: MessageCleanupScope;
}

function requiredFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required.`);
  return value.trim();
}

function cleanupFormValues(formData: FormData): CleanupFormValues {
  const reason = requiredFormString(formData, 'reason');
  if (reason.length > MESSAGE_CLEANUP_REASON_MAX_LENGTH) {
    throw new Error(`Reason must be ${MESSAGE_CLEANUP_REASON_MAX_LENGTH} characters or fewer.`);
  }
  const submittedToken = formData.get('idempotencyKey');
  const idempotencyToken =
    typeof submittedToken === 'string' && submittedToken.trim()
      ? submittedToken.trim()
      : randomUUID();
  if (!IDEMPOTENCY_TOKEN_PATTERN.test(idempotencyToken)) {
    throw new Error('The cleanup submission token is invalid. Refresh the case and try again.');
  }
  return {
    idempotencyToken,
    mode: messageCleanupJobModeSchema.parse(requiredFormString(formData, 'mode')),
    reason,
    scope: messageCleanupScopeSchema.parse(requiredFormString(formData, 'scope')),
  };
}

function requireUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function assertConfirmed(formData: FormData): void {
  if (formData.get('confirmAction') !== 'on') {
    throw new Error('Confirm the moderation action before queueing it.');
  }
}

async function cleanupActor(guildId: string, caseId: string): Promise<string> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/cases/${caseId}`);
  }
  const guild = await createSetupDashboardService().assertCanManageGuild(
    guildId,
    token.accessToken
  );
  if (
    !guild.owner &&
    !hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)
  ) {
    throw new Error('You need Administrator permission to manage case message cleanup.');
  }
  return session.userId;
}

async function moderatorBanActionEnabled(guildId: string): Promise<boolean> {
  const server = await createSetupDataAdapter().getServer(guildId);
  return server?.settings.moderator_ban_action_enabled !== false;
}

async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function lockPendingCase(
  client: PoolClient,
  guildId: string,
  caseId: string
): Promise<CleanupCaseRow> {
  const result = await client.query<CleanupCaseRow>(
    `select id::text, server_id, user_id, detection_event_id::text,
            private_evidence_thread_id, status::text as status
     from verification_events
     where server_id = $1 and id = $2::uuid
     for update`,
    [guildId, caseId]
  );
  const row = result.rows[0];
  if (!row) throw new Error('The moderation case was not found.');
  if (row.status !== 'pending') {
    throw new Error('Message cleanup is only available while the case is pending.');
  }
  if (!row.user_id) throw new Error('The moderation case does not have a target user.');
  if (!row.private_evidence_thread_id) {
    throw new Error('The moderation case does not have a private evidence thread.');
  }
  return row;
}

function idempotencyKey(
  actionType: ModerationActionRequestActionType,
  guildId: string,
  caseId: string,
  actorId: string,
  token: string
): string {
  return `message-cleanup:${actionType}:${guildId}:${caseId}:${actorId}:${token}`;
}

async function findRequest(client: PoolClient, key: string): Promise<CleanupRequestRow | null> {
  const result = await client.query<CleanupRequestRow>(
    `select id::text, action_type::text as action_type, actor_id,
            message_deletion_job_id::text, server_id, status::text as status,
            verification_event_id::text
     from moderation_action_requests
     where idempotency_key = $1
     limit 1`,
    [key]
  );
  return result.rows[0] ?? null;
}

function assertRequestMatches(
  request: CleanupRequestRow,
  actionType: ModerationActionRequestActionType,
  guildId: string,
  caseId: string,
  actorId: string,
  jobId?: string
): void {
  if (
    request.action_type !== actionType ||
    request.server_id !== guildId ||
    request.verification_event_id !== caseId ||
    request.actor_id !== actorId ||
    (jobId !== undefined && request.message_deletion_job_id !== jobId)
  ) {
    throw new Error('The cleanup submission token is already in use.');
  }
}

async function assertNoActiveRequest(client: PoolClient, caseId: string): Promise<void> {
  const result = await client.query<{ id: string }>(
    `select id::text from moderation_action_requests
     where verification_event_id = $1::uuid
       and status in ('queued', 'processing')
     limit 1`,
    [caseId]
  );
  if (result.rows[0]) {
    throw new Error('Another moderation action is already in progress for this case.');
  }
}

async function requeueFailedRequest(
  client: PoolClient,
  request: CleanupRequestRow
): Promise<CleanupRequestRow> {
  const result = await client.query<CleanupRequestRow>(
    `update moderation_action_requests
     set status = 'queued', updated_at = now(), started_at = null,
         failed_at = null, last_error = null
     where id = $1::uuid and status = 'failed'
     returning id::text, action_type::text as action_type, actor_id,
               message_deletion_job_id::text, server_id, status::text as status,
               verification_event_id::text`,
    [request.id]
  );
  return result.rows[0] ?? request;
}

function requestReceipt(request: CleanupRequestRow): ModerationActionRequestReceipt {
  return {
    id: request.id,
    messageDeletionJobId: request.message_deletion_job_id,
    status: request.status,
  };
}

async function insertRequest(
  client: PoolClient,
  input: {
    actionType: ModerationActionRequestActionType;
    actorId: string;
    caseRow: CleanupCaseRow;
    idempotencyKey: string;
    jobId: string;
    metadata: Record<string, unknown>;
  }
): Promise<ModerationActionRequestReceipt> {
  const result = await client.query<{
    id: string;
    messageDeletionJobId: string;
    status: ModerationActionRequestQueueStatus;
  }>(
    `insert into moderation_action_requests (
       server_id, action_type, status, actor_id, actor_surface, target_user_id,
       detection_event_id, verification_event_id, message_deletion_job_id,
       idempotency_key, metadata
     ) values (
       $1, $2::moderation_action_request_type, 'queued', $3, $4, $5,
       $6::uuid, $7::uuid, $8::uuid, $9, $10::jsonb
     )
     returning id::text, message_deletion_job_id::text as "messageDeletionJobId",
               status::text as status`,
    [
      input.caseRow.server_id,
      input.actionType,
      input.actorId,
      ACTOR_SURFACE,
      input.caseRow.user_id,
      input.caseRow.detection_event_id,
      input.caseRow.id,
      input.jobId,
      input.idempotencyKey,
      JSON.stringify(input.metadata),
    ]
  );
  const receipt = result.rows[0];
  if (!receipt) throw new Error('Drasil did not return an action request receipt.');
  return receipt;
}

function frozenJobBelongsToCase(job: CleanupJobRow, caseRow: CleanupCaseRow): boolean {
  return [
    job.server_id === caseRow.server_id,
    job.verification_event_id === caseRow.id,
    job.user_id === caseRow.user_id,
    job.evidence_thread_id === caseRow.private_evidence_thread_id,
    job.actor_surface === ACTOR_SURFACE,
  ].every(Boolean);
}

function frozenJobMatchesSubmission(
  job: CleanupJobRow,
  values: CleanupFormValues,
  expectedMode: MessageCleanupJobMode
): boolean {
  return [
    job.mode === expectedMode,
    values.mode === expectedMode,
    job.scope === values.scope,
    job.reason === values.reason,
  ].every(Boolean);
}

function frozenJobCanExecute(job: CleanupJobRow): boolean {
  return getMessageCleanupExecutionEligibility({
    mode: job.mode,
    status: job.status === 'executing' ? 'ready' : job.status,
    coverage: job.coverage,
    scope: job.scope,
    candidateCount: job.candidate_count,
    banStatus: job.ban_status,
    caseFinalizationStatus: job.case_finalization_status,
  }).canExecute;
}

function assertFrozenJob(
  job: CleanupJobRow,
  caseRow: CleanupCaseRow,
  values: CleanupFormValues,
  expectedMode: MessageCleanupJobMode
): void {
  if (!frozenJobBelongsToCase(job, caseRow)) {
    throw new Error('The cleanup preview does not belong to this case.');
  }
  if (!frozenJobMatchesSubmission(job, values, expectedMode)) {
    throw new Error('The cleanup preview changed. Refresh the case before continuing.');
  }
  if (!frozenJobCanExecute(job)) {
    throw new Error('The cleanup preview is not eligible for execution.');
  }
  if (
    expectedMode === 'ban_with_cleanup' &&
    !['not_requested', 'failed'].includes(job.ban_status) &&
    !isMessageCleanupFinalizationRetry({
      mode: job.mode,
      status: job.status,
      banStatus: job.ban_status,
      caseFinalizationStatus: job.case_finalization_status,
    })
  ) {
    throw new Error('The combined ban and cleanup has already started.');
  }
}

function assertPreviewJob(
  job: CleanupJobRow,
  caseRow: CleanupCaseRow,
  actorId: string,
  values: CleanupFormValues
): void {
  if (
    job.server_id !== caseRow.server_id ||
    job.verification_event_id !== caseRow.id ||
    job.user_id !== caseRow.user_id ||
    job.evidence_thread_id !== caseRow.private_evidence_thread_id ||
    job.requested_by !== actorId ||
    job.actor_surface !== ACTOR_SURFACE ||
    job.mode !== values.mode ||
    job.scope !== values.scope ||
    job.reason !== values.reason
  ) {
    throw new Error('The existing cleanup preview does not match this submission.');
  }
}

async function lockJob(client: PoolClient, jobId: string): Promise<CleanupJobRow> {
  const result = await client.query<CleanupJobRow>(
    `select id::text, server_id, user_id, verification_event_id::text,
            requested_by, actor_surface, mode::text as mode, scope::text as scope,
            status::text as status, coverage::text as coverage, reason,
            evidence_thread_id, candidate_count, ban_status::text as ban_status,
            case_finalization_status::text as case_finalization_status
     from message_deletion_jobs
     where id = $1::uuid
     for update`,
    [jobId]
  );
  const job = result.rows[0];
  if (!job) throw new Error('The message cleanup preview was not found.');
  return job;
}

async function queuePreview(
  guildId: string,
  caseId: string,
  actorId: string,
  values: CleanupFormValues
): Promise<ModerationActionRequestReceipt> {
  const actionType = 'preview_case_message_deletion' as const;
  const key = idempotencyKey(actionType, guildId, caseId, actorId, values.idempotencyToken);
  return inTransaction(async (client) => {
    const caseRow = await lockPendingCase(client, guildId, caseId);
    const existing = await findRequest(client, key);
    if (existing) {
      assertRequestMatches(existing, actionType, caseRow.server_id, caseRow.id, actorId);
      assertPreviewJob(
        await lockJob(client, existing.message_deletion_job_id),
        caseRow,
        actorId,
        values
      );
      if (existing.status === 'failed') {
        await assertNoActiveRequest(client, caseId);
      }
      return requestReceipt(
        existing.status === 'failed' ? await requeueFailedRequest(client, existing) : existing
      );
    }
    await assertNoActiveRequest(client, caseId);
    const jobResult = await client.query<{ id: string }>(
      `insert into message_deletion_jobs (
         server_id, user_id, verification_event_id, requested_by, actor_surface,
         mode, scope, reason, evidence_thread_id, metadata
       ) values (
         $1, $2, $3::uuid, $4, $5, $6::message_deletion_job_mode,
         $7::message_deletion_scope, $8, $9, $10::jsonb
       ) returning id::text`,
      [
        caseRow.server_id,
        caseRow.user_id,
        caseRow.id,
        actorId,
        ACTOR_SURFACE,
        values.mode,
        values.scope,
        values.reason,
        caseRow.private_evidence_thread_id,
        JSON.stringify({ source: ACTOR_SURFACE }),
      ]
    );
    const jobId = jobResult.rows[0]?.id;
    if (!jobId) throw new Error('Drasil could not create the message cleanup preview.');
    return insertRequest(client, {
      actionType,
      actorId,
      caseRow,
      idempotencyKey: key,
      jobId,
      metadata: { cleanup_mode: values.mode, cleanup_scope: values.scope },
    });
  });
}

async function queueFrozenJob(
  guildId: string,
  caseId: string,
  jobId: string,
  actorId: string,
  values: CleanupFormValues,
  actionType: 'execute_case_message_deletion' | 'ban_case_user_with_message_cleanup',
  expectedMode: MessageCleanupJobMode,
  banActionEnabled = true
): Promise<ModerationActionRequestReceipt> {
  const key = idempotencyKey(actionType, guildId, caseId, actorId, values.idempotencyToken);
  return inTransaction(async (client) => {
    const existing = await findRequest(client, key);
    if (existing) {
      assertRequestMatches(existing, actionType, guildId, caseId, actorId, jobId);
      return requestReceipt(existing);
    }

    const caseRow = await lockPendingCase(client, guildId, caseId);
    const job = await lockJob(client, jobId);
    assertFrozenJob(job, caseRow, values, expectedMode);
    if (
      expectedMode === 'ban_with_cleanup' &&
      !banActionEnabled &&
      !isMessageCleanupFinalizationRetry({
        mode: job.mode,
        status: job.status,
        banStatus: job.ban_status,
        caseFinalizationStatus: job.case_finalization_status,
      })
    ) {
      throw new Error('Moderator ban actions are disabled for this server.');
    }
    await assertNoActiveRequest(client, caseId);
    return insertRequest(client, {
      actionType,
      actorId,
      caseRow,
      idempotencyKey: key,
      jobId,
      metadata: { cleanup_mode: job.mode, cleanup_scope: job.scope },
    });
  });
}

function fixtureCleanupReceipt(
  actionType:
    | 'preview_case_message_deletion'
    | 'execute_case_message_deletion'
    | 'ban_case_user_with_message_cleanup',
  formData: FormData,
  expectedMode: MessageCleanupJobMode,
  message: string
): InboxActionState {
  const values = cleanupFormValues(formData);
  if (values.mode !== expectedMode) {
    throw new Error('The cleanup action does not match the frozen preview mode.');
  }
  const submittedJobId = formData.get('jobId');
  const jobId =
    typeof submittedJobId === 'string' && submittedJobId.trim()
      ? submittedJobId.trim()
      : `fixture-preview-${values.idempotencyToken}`;
  return queuedInboxActionState(
    {
      id: `fixture-${actionType}-${values.idempotencyToken}`,
      messageDeletionJobId: jobId,
      status: 'queued',
    },
    message
  );
}

function revalidateCleanupPaths(guildId: string, caseId: string): void {
  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/cases/${caseId}`);
  revalidatePath(`/admin/guild/${guildId}/history`);
}

export async function previewCaseMessageCleanup(
  guildId: string,
  caseId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    if (isWebE2eFixtureMode()) {
      return fixtureCleanupReceipt(
        'preview_case_message_deletion',
        formData,
        messageCleanupJobModeSchema.parse(requiredFormString(formData, 'mode')),
        'Message cleanup preview queued.'
      );
    }
    requireUuid(caseId, 'Case id');
    const values = cleanupFormValues(formData);
    const actorId = await cleanupActor(guildId, caseId);
    const receipt = await queuePreview(guildId, caseId, actorId, values);
    revalidateCleanupPaths(guildId, caseId);
    return queuedInboxActionState(receipt, 'Message cleanup preview queued.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}

export async function executeCaseMessageCleanup(
  guildId: string,
  caseId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    if (isWebE2eFixtureMode()) {
      assertConfirmed(formData);
      return fixtureCleanupReceipt(
        'execute_case_message_deletion',
        formData,
        'delete_only',
        'Message cleanup queued.'
      );
    }
    requireUuid(caseId, 'Case id');
    assertConfirmed(formData);
    const jobId = requireUuid(requiredFormString(formData, 'jobId'), 'Cleanup job id');
    const values = cleanupFormValues(formData);
    const actorId = await cleanupActor(guildId, caseId);
    const receipt = await queueFrozenJob(
      guildId,
      caseId,
      jobId,
      actorId,
      values,
      'execute_case_message_deletion',
      'delete_only'
    );
    revalidateCleanupPaths(guildId, caseId);
    return queuedInboxActionState(receipt, 'Message cleanup queued.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}

export async function banCaseUserWithMessageCleanup(
  guildId: string,
  caseId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    if (isWebE2eFixtureMode()) {
      assertConfirmed(formData);
      return fixtureCleanupReceipt(
        'ban_case_user_with_message_cleanup',
        formData,
        'ban_with_cleanup',
        'Ban and message cleanup queued.'
      );
    }
    requireUuid(caseId, 'Case id');
    assertConfirmed(formData);
    const jobId = requireUuid(requiredFormString(formData, 'jobId'), 'Cleanup job id');
    const values = cleanupFormValues(formData);
    const actorId = await cleanupActor(guildId, caseId);
    const banActionEnabled = await moderatorBanActionEnabled(guildId);
    const receipt = await queueFrozenJob(
      guildId,
      caseId,
      jobId,
      actorId,
      values,
      'ban_case_user_with_message_cleanup',
      'ban_with_cleanup',
      banActionEnabled
    );
    revalidateCleanupPaths(guildId, caseId);
    return queuedInboxActionState(receipt, 'Ban and message cleanup queued.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}
