import { ActionDeniedError } from '../results';
import type { ActionContext } from '../context';
import { workflowDefinitions, type HumanCommand } from './commands';
import { confirmationRequirement } from './confirmationPolicy';
import { createIntentService, IntentError } from './intents';
import type { DelegatedAccess } from './access';
import type {
  ActionCompletion,
  ConfirmationMethod,
  DelegatedPrincipal,
  DelegationStore,
  DirectActionExecutor,
  ExecutionRecord,
  IntentInvocation,
  IntentRecord,
  IntentResolver,
  PublicActionResult,
  PublicItemOutcome,
  PublicScalar,
} from './types';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function scalar(value: unknown): value is PublicScalar {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (typeof value === 'string' && value.length <= 500)
  );
}
/** Family allowlists intentionally omit record IDs, actor/provenance, secrets and raw errors. */
export function projectHumanOutcome(command: HumanCommand, value: unknown): ActionCompletion {
  const raw = record(value);
  const nested = record(raw.result);
  if (
    raw.action_type === 'delegated_admission' &&
    (raw.state === 'denied' ||
      raw.state === 'uncertain' ||
      raw.state === 'partial' ||
      ((command.kind === 'ban_user' || command.kind === 'kick_user') &&
        (raw.state === 'completed' || raw.state === 'failed')))
  )
    return {
      state: raw.state as ActionCompletion['state'],
      ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
      ...(typeof record(raw.outcome).succeeded === 'boolean'
        ? { outcome: { succeeded: record(raw.outcome).succeeded as boolean } }
        : {}),
    };
  if (raw.kind === 'attention_batch') {
    const items: PublicItemOutcome[] = Array.isArray(raw.items)
      ? raw.items.map((value) => {
          const item = record(value);
          const state =
            item.state === 'completed' || item.state === 'denied' || item.state === 'failed'
              ? item.state
              : 'uncertain';
          return {
            itemId: String(item.itemId),
            state,
            ...(typeof item.status === 'string' ? { status: item.status } : {}),
          };
        })
      : [];
    return {
      state: items.some((item) => item.state !== 'completed') ? 'partial' : 'completed',
      outcome: { items },
    };
  }
  const reportBan = record(raw.observed_ban_result);
  const status =
    typeof reportBan.status === 'string'
      ? reportBan.status
      : typeof raw.status === 'string'
        ? raw.status
        : typeof nested.status === 'string'
          ? nested.status
          : undefined;
  const outcome: {
    status?: string;
    queueCleanupStatus?: string;
    succeeded?: boolean;
    count?: number;
    details?: Record<string, PublicScalar>;
  } = {};
  if (status) outcome.status = status;
  if (typeof raw.queueCleanupStatus === 'string')
    outcome.queueCleanupStatus = raw.queueCleanupStatus;
  if (typeof raw.succeeded === 'boolean') outcome.succeeded = raw.succeeded;
  if (typeof raw.count === 'number') outcome.count = raw.count;
  const family = workflowDefinitions.find((item) => item.commandKind === command.kind)?.family;
  const keys: Record<string, readonly string[]> = {
    cases: [
      'opened',
      'verified',
      'closed_count',
      'kicked',
      'banned',
      'repaired',
      'reopened',
      'refreshed',
      'synced_count',
      'flagged',
      'case_role_active',
    ],
    detections: ['dismissed', 'kicked', 'undone_action', 'ignored', 'restored', 'ban_by_id'],
    reports: [
      'statusRecorded',
      'submitted',
      'closed',
      'created',
      'opened',
      'existing_open_intake',
      'thread_archived',
    ],
    reportReview: ['opened'],
    attention: [],
    setup: [
      'action',
      'completed',
      'created',
      'updated',
      'case_role_created',
      'report_instructions_action',
      'verification_channel_action',
    ],
    cleanup: [
      'candidate_count',
      'coverage',
      'scope',
      'mode',
      'already_completed',
      'preserved_count',
      'deleted_count',
      'already_missing_count',
      'changed_since_preview_count',
      'evidence_failed_count',
      'delete_failed_count',
      'permission_denied_count',
      'banned',
      'case_finalized',
    ],
    captcha: ['status', 'delivered', 'bypassed'],
    quarantine: [
      'parked',
      'containment_status',
      'failed_role_removals',
      'member_bypasses',
      'retained_roles',
      'can_contain',
      'enabled',
      'lockdown_error_count',
      'lockdown_planned_actions',
      'recovery_thread_ready',
      'admin_notification_ready',
      'case_role_ready',
    ],
    operations: [
      'synced',
      'removed_count',
      'already_closed_threads',
      'checked_cases',
      'checked_threads',
      'closed_threads',
      'failed_threads',
      'missing_threads',
      'would_close_threads',
      'applied_writes',
      'enabled',
      'error_count',
      'failed_writes',
      'planned_writes',
      'warning_count',
      'eligible_members',
      'execute',
      'failed',
      'opened',
      'processed',
      'skipped_active_cases',
      'skipped_bots',
      'skipped_over_limit',
      'total_members',
    ],
  };
  const details: Record<string, PublicScalar> = {};
  const allowedKeys =
    command.kind === 'ban_user'
      ? ['banned']
      : command.kind === 'kick_user'
        ? ['kicked']
        : (keys[family ?? ''] ?? []);
  for (const key of allowedKeys) {
    const candidate = raw[key] ?? nested[key];
    if (candidate !== undefined && scalar(candidate)) details[key] = candidate;
  }
  if (command.kind === 'prepare_report_ban_review') {
    if (
      typeof raw.reviewReference === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.reviewReference)
    )
      details.reviewReference = raw.reviewReference;
    if (
      typeof raw.expiresAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/.test(raw.expiresAt) &&
      Number.isFinite(Date.parse(raw.expiresAt))
    )
      details.expiresAt = raw.expiresAt;
  }
  if (Object.keys(details).length) outcome.details = details;
  const partial =
    (family === 'reports' && raw.status === 'submitted' && raw.statusRecorded === false) ||
    [
      'delete_failed_count',
      'evidence_failed_count',
      'permission_denied_count',
      'failed_role_removals',
      'failed_threads',
      'failed_writes',
      'failed',
    ].some((key) => typeof raw[key] === 'number' && raw[key] > 0) ||
    (family === 'captcha' && raw.delivered === false) ||
    (family === 'setup' && typeof raw.report_instructions_error === 'string') ||
    (command.kind === 'quarantine_compromised_account' && raw.parked === false) ||
    (command.kind === 'ban_case_user_with_message_cleanup' &&
      raw.banned === true &&
      raw.case_finalized === false);
  const state =
    status === 'ban_outcome_unknown' || status === 'uncertain'
      ? 'uncertain'
      : status === 'banned_updates_pending' ||
          status === 'incomplete' ||
          status === 'partial' ||
          outcome.queueCleanupStatus === 'failed' ||
          partial
        ? 'partial'
        : status === 'failed' || status === 'create_failed' || status === 'activation_failed'
          ? 'failed'
          : status === 'denied'
            ? 'denied'
            : 'completed';
  return { state, outcome };
}
export function projectExecution(execution: ExecutionRecord): PublicActionResult {
  const base = {
    executionId: execution.executionId,
    operation: execution.workflowId,
    guildId: execution.guildId,
    ...(execution.queueRequestId ? { requestId: execution.queueRequestId } : {}),
    ...('targetUserId' in execution.command
      ? { targetUserId: execution.command.targetUserId }
      : {}),
  };
  if (execution.outcome) return { ...base, ...execution.outcome.result };
  // A previous process may have died after dispatch. A receipt retry never repeats effects.
  const state = execution.startedAt
    ? execution.queueRequestId
      ? 'running'
      : 'uncertain'
    : 'queued';
  return { ...base, state, retryAfterMs: 2000 };
}
export function projectIntent(intent: IntentRecord): PublicActionResult {
  if (intent.state !== 'pending') return { state: 'denied', code: intent.state };
  return {
    state: 'confirmation_required',
    confirmationId: intent.confirmationId,
    operation: intent.workflowId,
    guildId: intent.guildId,
    summary: intent.summary,
    expiresAt: intent.expiresAt.toISOString(),
  };
}
export interface DelegatedActionService {
  submit(principal: DelegatedPrincipal, invocation: IntentInvocation): Promise<PublicActionResult>;
  confirm(
    principal: DelegatedPrincipal,
    confirmationId: string,
    method: Exclude<ConfirmationMethod, 'not_required'>
  ): Promise<PublicActionResult>;
  status(principal: DelegatedPrincipal, executionId: string): Promise<PublicActionResult>;
  cancel(principal: DelegatedPrincipal, confirmationId: string): Promise<PublicActionResult>;
}
export function createDelegatedActionService(deps: {
  readonly store: DelegationStore;
  readonly access: DelegatedAccess;
  readonly resolver: IntentResolver;
  readonly direct: DirectActionExecutor;
  readonly now?: () => number;
  readonly waitForExecution?: (
    work: Promise<PublicActionResult>,
    pending: () => PublicActionResult
  ) => Promise<PublicActionResult>;
}): DelegatedActionService {
  const intents = createIntentService(deps);
  async function safe(work: () => Promise<PublicActionResult>): Promise<PublicActionResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof IntentError || error instanceof ActionDeniedError)
        return { state: 'denied', code: error.code };
      throw error;
    }
  }
  async function acceptSaved(
    principal: DelegatedPrincipal,
    id: string,
    method: ConfirmationMethod
  ): Promise<ExecutionRecord> {
    try {
      return method === 'not_required'
        ? await intents.acceptWithoutConfirmation(principal, id)
        : await intents.acceptIntent(principal, id, method);
    } catch (error) {
      if (error instanceof IntentError && error.code === 'queue_conflict')
        await deps.store.denyIntent(principal, id);
      throw error;
    }
  }
  async function run(
    principal: DelegatedPrincipal,
    execution: ExecutionRecord
  ): Promise<PublicActionResult> {
    // Receipt delivery is an authorization boundary too, including consumed-confirm retries.
    const access = await deps.access.authorizeWorkflow(
      principal,
      execution.guildId,
      execution.command
    );
    if (access.kind === 'denied') return { state: 'denied', code: access.reason };
    if (execution.authorizedDelivery.kind === 'report_case_terminal')
      return projectExecution(execution);
    if (execution.authorizedDelivery.kind === 'queued') {
      const current = await deps.store.loadExecution(principal, execution.executionId);
      return current ? projectExecution(current) : { state: 'denied', code: 'not_found' };
    }
    if (execution.startedAt || execution.completedAt) return projectExecution(execution);
    const admitted = await deps.store.startDirectExecution(execution.executionId, () =>
      deps.access.authorizeWorkflow(principal, execution.guildId, execution.command)
    );
    if (admitted.kind === 'denied') return { state: 'denied', code: admitted.code };
    if (admitted.kind !== 'new_execution')
      return admitted.kind === 'ordinary'
        ? { state: 'denied', code: 'binding_mismatch' }
        : projectExecution(admitted.execution);
    const context: ActionContext = {
      guildId: execution.guildId,
      requestId: execution.executionId,
      source: 'mcp',
      actor: { kind: 'user', userId: execution.userId },
    };
    const work = (async (): Promise<PublicActionResult> => {
      let result: ActionCompletion;
      try {
        result = projectHumanOutcome(
          execution.command,
          await deps.direct.execute(context, execution.command, execution.preconditions)
        );
      } catch (error) {
        result =
          error instanceof ActionDeniedError
            ? { state: 'denied', code: error.code }
            : { state: 'uncertain', code: 'execution_interrupted' };
      }
      await deps.store.completeExecution(execution.executionId, result);
      return { ...projectExecution(admitted.execution), ...result, retryAfterMs: undefined };
    })();
    return deps.waitForExecution
      ? deps.waitForExecution(work, () => projectExecution(admitted.execution))
      : work;
  }
  return {
    submit: (principal, invocation) =>
      safe(async () => {
        const intent = await intents.prepareIntent(principal, invocation);
        if (intent.state === 'consumed' && intent.executionId) {
          const execution = await deps.store.loadExecution(principal, intent.executionId);
          return execution ? run(principal, execution) : { state: 'denied', code: 'not_found' };
        }
        if (
          intent.state !== 'pending' ||
          (intent.authorizedDelivery.kind !== 'report_case_terminal' &&
            confirmationRequirement(intent.command) !== 'none')
        )
          return projectIntent(intent);
        return run(principal, await acceptSaved(principal, intent.confirmationId, 'not_required'));
      }),
    confirm: (principal, id, method) =>
      safe(async () => run(principal, await acceptSaved(principal, id, method))),
    status: (principal, id) =>
      safe(async () => {
        const execution = await deps.store.loadExecution(principal, id);
        if (!execution) return { state: 'denied', code: 'not_found' };
        const decision = await deps.access.authorizeRead(principal, {
          kind: 'own_execution',
          guildId: execution.guildId,
          userId: execution.userId,
          connectionId: execution.connectionId,
          workflowId: execution.workflowId,
        });
        return decision.kind === 'allowed'
          ? projectExecution(execution)
          : { state: 'denied', code: decision.reason };
      }),
    cancel: (principal, id) =>
      safe(async () => {
        const intent = await intents.cancelIntent(principal, id);
        return { state: 'denied', code: intent?.state ?? 'not_found' };
      }),
  };
}
