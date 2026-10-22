import { z } from 'zod';
import { ActionDeniedError } from '../results';
import { canonicalDigest, IntentError } from '../delegation/intents';
import { decodeQueuedAction } from '../requests/decode';
import type { IntentRecord } from '../delegation/types';
import type { ContainmentResolutionResources, ResolvedPreview } from '../containment/resolution';
import type { DelegationDatabase, DelegationQueryClient } from './delegation';
const uuid = z.string().uuid();
const jobSchema = z.object({
  id: z.string(),
  server_id: z.string(),
  user_id: z.string(),
  verification_event_id: z.string(),
  requested_by: z.string(),
  actor_surface: z.string(),
  mode: z.enum(['delete_only', 'ban_with_cleanup']),
  scope: z.enum(['source_message', 'last_hour', 'last_day', 'last_7_days']),
  reason: z.string(),
  evidence_thread_id: z.string(),
  previewed_at: z.coerce.date(),
  status: z.string(),
  coverage: z.string().nullable(),
  candidate_count: z.number(),
  ban_status: z.enum(['not_requested', 'pending', 'succeeded', 'failed']),
  case_finalization_status: z.enum(['not_applicable', 'pending', 'succeeded', 'failed']),
});
const resultSchema = z
  .object({
    action_type: z.string(),
    target_user_id: z.string(),
    verification_event_id: z.string(),
  })
  .passthrough();
const roleSchema = z.array(z.object({ role_id: z.string() }));
/** Read-only family resources, reusable in the web and bot compositions. */
export function createContainmentResources(
  database: DelegationDatabase
): ContainmentResolutionResources {
  return {
    async loadCase(guildId, caseId): ReturnType<ContainmentResolutionResources['loadCase']> {
      if (!uuid.safeParse(caseId).success) return null;
      const rows = await database.query<{
        id: string;
        guildId: string;
        targetUserId: string | null;
        status: string;
        caseKind: string;
        revision: number;
        evidenceThreadId: string | null;
        detectionEventId: string | null;
        challenge: { id: string; generation: number } | null;
      }>(
        `select v.id,v.server_id as "guildId",v.user_id as "targetUserId",v.status,v.case_kind as "caseKind",v.case_revision as revision,v.private_evidence_thread_id as "evidenceThreadId",v.detection_event_id as "detectionEventId",case when c.id is null then null else jsonb_build_object('id',c.id,'generation',c.generation) end as challenge from verification_events v left join captcha_challenges c on c.verification_event_id=v.id where v.id=$1::uuid and v.server_id=$2`,
        [caseId, guildId]
      );
      return rows.rows[0] ?? null;
    },
    async loadPolicy(guildId): ReturnType<ContainmentResolutionResources['loadPolicy']> {
      const row = (
        await database.query<{ settings: Record<string, unknown> }>(
          `select settings from servers where guild_id=$1`,
          [guildId]
        )
      ).rows[0];
      if (!row) throw new ActionDeniedError('stale_state');
      const settings = row.settings ?? {};
      return {
        captchaEnabled: ['manual', 'suspicious_join'].includes(String(settings.captcha_mode)),
        quarantineEnabled: settings.account_quarantine_enabled === true,
        banEnabled: settings.moderator_ban_action_enabled !== false,
      };
    },
    async resolvePreviewReference(principal, reference): Promise<ResolvedPreview> {
      if (!uuid.safeParse(reference).success) throw new ActionDeniedError('preview_not_found');
      const row = (
        await database.query<{
          resolved: IntentRecord;
          queue: Record<string, unknown>;
          job: unknown;
        }>(
          `select e.resolved,to_jsonb(q) as queue,to_jsonb(j) as job from mcp_executions e join moderation_action_requests q on q.id=e.queue_request_id left join message_deletion_jobs j on j.id=q.message_deletion_job_id where e.id=$1::uuid and e.user_id=$2 and e.client_id=$3 and e.connection_id=$4::uuid and e.grant_version=$5 and e.started_at is not null and q.status='completed' and q.completed_at is not null and q.actor_surface='mcp' and q.actor_id=e.user_id and q.server_id=e.resolved->>'guildId' and q.metadata->'delegation'->>'executionId'=e.id::text and q.metadata->'delegation'->>'connectionId'=e.connection_id::text and q.metadata->'delegation'->>'grantVersion'=e.grant_version::text and q.metadata->'delegation'->>'commandDigest'=e.resolved->'authorizedDelivery'->>'commandDigest'`,
          [
            reference,
            principal.userId,
            principal.clientId,
            principal.connectionId,
            principal.grantVersion,
          ]
        )
      ).rows[0];
      if (!row) throw new ActionDeniedError('preview_not_found');
      const command = decodeQueuedAction(row.queue).command;
      const resolved = row.resolved;
      if (
        resolved.authorizedDelivery.kind !== 'queued' ||
        canonicalDigest(command) !== resolved.commandDigest ||
        canonicalDigest(command) !== resolved.authorizedDelivery.commandDigest ||
        canonicalDigest(command) !== canonicalDigest(resolved.command) ||
        resolved.workflowId !== command.kind
      )
        throw new ActionDeniedError('binding_mismatch');
      const receipt = resultSchema.parse(row.queue.result);
      if (
        !('caseId' in command) ||
        receipt.action_type !== command.kind ||
        receipt.verification_event_id !== command.caseId ||
        receipt.target_user_id !== command.targetUserId
      )
        throw new ActionDeniedError('binding_mismatch');
      const binding = {
        guildId: resolved.guildId,
        caseId: command.caseId,
        targetUserId: command.targetUserId,
      };
      if (command.kind === 'preview_account_quarantine') {
        const fingerprint = z.string().min(1).parse(receipt.containment_fingerprint);
        const expiresAt = new Date(
          z.coerce.date().parse(row.queue.completed_at).getTime() + 10 * 60 * 1000
        );
        if (expiresAt.getTime() <= Date.now()) throw new ActionDeniedError('preview_expired');
        return {
          ...binding,
          kind: 'quarantine',
          requestId: String(row.queue.id),
          fingerprint,
          expiresAt,
          plannedRoleIds: roleSchema.parse(receipt.planned_roles).map((r) => r.role_id),
          retainedRoleIds: roleSchema.parse(receipt.retained_roles).map((r) => r.role_id),
          canContain: z.boolean().parse(receipt.can_contain),
        };
      }
      if (command.kind !== 'preview_case_message_deletion')
        throw new ActionDeniedError('preview_not_found');
      const job = jobSchema.parse(row.job);
      const generation = job.previewed_at.toISOString();
      if (
        job.id !== command.jobId ||
        receipt.message_deletion_job_id !== job.id ||
        receipt.preview_generation !== generation ||
        job.server_id !== binding.guildId ||
        job.verification_event_id !== binding.caseId ||
        job.user_id !== binding.targetUserId ||
        job.requested_by !== principal.userId ||
        job.actor_surface !== 'mcp' ||
        job.mode !== command.mode ||
        job.scope !== command.scope ||
        job.reason !== command.reason
      )
        throw new ActionDeniedError('stale_state');
      return {
        ...binding,
        kind: 'cleanup',
        expiresAt: null,
        detectionEventId: command.detectionEventId,
        job: {
          id: job.id,
          ...binding,
          requestedBy: job.requested_by,
          source: job.actor_surface,
          mode: job.mode,
          scope: job.scope,
          reason: job.reason,
          evidenceThreadId: job.evidence_thread_id,
          generation,
          status: job.status,
          coverage: job.coverage,
          candidateCount: job.candidate_count,
          banStatus: job.ban_status,
          caseFinalizationStatus: job.case_finalization_status,
        },
      };
    },
  };
}
type CleanupCommand = Extract<
  IntentRecord['command'],
  {
    kind:
      | 'preview_case_message_deletion'
      | 'execute_case_message_deletion'
      | 'ban_case_user_with_message_cleanup';
  }
>;
type CleanupCaseState = {
  user_id: string | null;
  status: string;
  private_evidence_thread_id: string | null;
  case_revision: number;
  detection_event_id: string | null;
};

/** Fixed domain branch in the same transaction as queue/execution/intent acceptance. */
export async function acceptCleanupJob(
  client: DelegationQueryClient,
  intent: IntentRecord
): Promise<void> {
  const command = intent.command;
  if (
    command.kind !== 'preview_case_message_deletion' &&
    command.kind !== 'execute_case_message_deletion' &&
    command.kind !== 'ban_case_user_with_message_cleanup'
  )
    return;
  const state = (
    await client.query<CleanupCaseState>(
      `select user_id,status,private_evidence_thread_id,case_revision,detection_event_id from verification_events where id=$1::uuid and server_id=$2 for update`,
      [command.caseId, intent.guildId]
    )
  ).rows[0];
  if (
    !state ||
    state.status !== 'pending' ||
    state.user_id !== command.targetUserId ||
    !state.private_evidence_thread_id ||
    state.detection_event_id !== command.detectionEventId
  )
    throw new IntentError('stale_state');
  const active = await client.query<{ id: string }>(
    `select id from moderation_action_requests where verification_event_id=$1::uuid and status in ('queued','processing') limit 1`,
    [command.caseId]
  );
  if (active.rows.length) throw new IntentError('queue_conflict');
  if (command.kind === 'preview_case_message_deletion')
    await provisionCleanupJob(client, intent, command, state);
  else await acceptCleanupPreview(client, intent, command, state);
}

async function provisionCleanupJob(
  client: DelegationQueryClient,
  intent: IntentRecord,
  command: Extract<CleanupCommand, { kind: 'preview_case_message_deletion' }>,
  state: CleanupCaseState
): Promise<void> {
  const p = intent.preconditions;
  if (
    p.kind !== 'cleanup_job_provision' ||
    p.jobId !== command.jobId ||
    p.caseId !== command.caseId ||
    p.targetUserId !== command.targetUserId ||
    p.revision !== state.case_revision ||
    p.evidenceThreadId !== state.private_evidence_thread_id ||
    p.detectionEventId !== state.detection_event_id ||
    command.previewReference.jobId !== p.jobId ||
    command.previewReference.generation !== null
  )
    throw new IntentError('stale_state');
  const inserted = await client.query<{ id: string }>(
    `insert into message_deletion_jobs(id,server_id,user_id,verification_event_id,requested_by,actor_surface,mode,scope,reason,evidence_thread_id,metadata) values($1::uuid,$2,$3,$4::uuid,$5,'mcp',$6::message_deletion_job_mode,$7::message_deletion_scope,$8,$9,'{"source":"mcp"}'::jsonb) on conflict(id) do nothing returning id`,
    [
      p.jobId,
      intent.guildId,
      command.targetUserId,
      command.caseId,
      intent.userId,
      command.mode,
      command.scope,
      command.reason,
      p.evidenceThreadId,
    ]
  );
  if (!inserted.rows.length) throw new IntentError('queue_conflict');
}

async function acceptCleanupPreview(
  client: DelegationQueryClient,
  intent: IntentRecord,
  command: Exclude<CleanupCommand, { kind: 'preview_case_message_deletion' }>,
  state: CleanupCaseState
): Promise<void> {
  const p = intent.preconditions;
  const row = (
    await client.query<{ job: unknown }>(
      `select to_jsonb(j) as job from message_deletion_jobs j where id=$1::uuid for update`,
      [command.jobId]
    )
  ).rows[0];
  const job = jobSchema.safeParse(row?.job);
  if (
    !job.success ||
    p.kind !== 'cleanup_preview' ||
    p.jobId !== command.jobId ||
    p.generation !== job.data.previewed_at.toISOString() ||
    job.data.server_id !== intent.guildId ||
    job.data.user_id !== command.targetUserId ||
    job.data.verification_event_id !== command.caseId ||
    job.data.requested_by !== intent.userId ||
    job.data.actor_surface !== 'mcp' ||
    job.data.evidence_thread_id !== state.private_evidence_thread_id ||
    job.data.mode !== command.mode ||
    job.data.scope !== command.scope ||
    job.data.reason !== command.reason
  )
    throw new IntentError('stale_state');
}

/** Admission only selects a completion-only adapter. It never authorizes another effect. */
export async function hasCommittedContainment(
  client: DelegationQueryClient,
  execution: import('../delegation/types').ExecutionRecord,
  request: import('../requests/decode').QueuedRow
): Promise<boolean> {
  if (!execution.startedAt || execution.completedAt) return false;
  const command = execution.command;
  if (
    ['request_captcha_challenge', 'retry_captcha_challenge', 'bypass_captcha_challenge'].includes(
      command.kind
    )
  ) {
    const operation =
      command.kind === 'request_captcha_challenge'
        ? 'request'
        : command.kind === 'retry_captcha_challenge'
          ? 'retry'
          : 'bypass';
    const receipt = z
      .object({
        operation: z.literal(operation),
        challenge_id: z.string().min(1),
        generation: z.number().int().positive(),
      })
      .safeParse(request.metadata?.captcha_mutation_receipt);
    if (!receipt.success) return false;
    const persisted = (
      await client.query<{ receipt: unknown }>(
        `select metadata->'captcha_mutation_receipt' as receipt from moderation_action_requests where id=$1::uuid`,
        [request.id]
      )
    ).rows[0];
    return (
      canonicalDigest(persisted?.receipt ?? null) ===
      canonicalDigest(request.metadata?.captcha_mutation_receipt)
    );
  }
  if (command.kind === 'quarantine_compromised_account') {
    const state = (
      await client.query<{ valid: boolean }>(
        `select case_kind='compromised_account' and quarantine_attempt_id is null and metadata->'account_quarantine'->>'moderation_action_request_id'=$4 and ((metadata->'account_quarantine'->>'result'='contained' and attention_state='parked' and containment_status='contained') or (metadata->'account_quarantine'->>'result'='incomplete' and attention_state='review_required' and containment_status='incomplete')) as valid from verification_events where id=$1::uuid and server_id=$2 and user_id=$3`,
        [command.caseId, execution.guildId, command.targetUserId, request.id]
      )
    ).rows[0];
    return state?.valid === true;
  }
  if (
    command.kind === 'execute_case_message_deletion' ||
    command.kind === 'ban_case_user_with_message_cleanup'
  ) {
    const job = (
      await client.query<{ status: string; ban_status: string; metadata: Record<string, unknown> }>(
        `select status,ban_status,metadata from message_deletion_jobs where id=$1::uuid and server_id=$2 and user_id=$3 and verification_event_id=$4::uuid and actor_surface='mcp' and requested_by=$5 and previewed_at=$6::timestamptz`,
        [
          command.jobId,
          execution.guildId,
          command.targetUserId,
          command.caseId,
          execution.userId,
          command.previewReference.generation,
        ]
      )
    ).rows[0];
    if (!job || job.status !== 'completed') return false;
    if (command.kind === 'execute_case_message_deletion') return true;
    return (
      job.ban_status === 'succeeded' &&
      canonicalDigest(job.metadata?.combined_operation ?? null) ===
        canonicalDigest({ requestId: request.id, actorId: execution.userId, source: 'mcp' })
    );
  }
  return false;
}
