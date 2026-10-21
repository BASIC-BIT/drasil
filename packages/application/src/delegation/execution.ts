import type { McpOperationalPort } from './operations';
import { ActionDeniedError } from '../results';
import {
  setupFailureDefinitions,
  setupPublicDiagnosticCodes,
  type SetupFailureCode,
} from '../setup/outcomes';
import type { ActionContext } from '../context';
import { workflowDefinitions, type HumanCommand } from './commands';
import { confirmationRequirement } from './confirmationPolicy';
import { createIntentService, IntentError } from './intents';
import type { DelegatedAccess, AccessDecision } from './access';
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
  const setupFailureCode =
    command.kind === 'complete_setup_verification' &&
    raw.action_type === command.kind &&
    typeof raw.code === 'string' &&
    Object.prototype.hasOwnProperty.call(setupFailureDefinitions, raw.code)
      ? (raw.code as SetupFailureCode)
      : undefined;
  const setupFailure = setupFailureCode ? setupFailureDefinitions[setupFailureCode] : undefined;
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
  if (setupFailure) {
    details.detail = setupFailure.detail;
    for (const key of ['error_count', 'warning_count']) {
      const count = raw[key];
      if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)
        details[key] = count;
    }
    if (
      typeof raw.diagnostic_code === 'string' &&
      setupPublicDiagnosticCodes.has(raw.diagnostic_code)
    )
      details.diagnostic_code = raw.diagnostic_code;
  }
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
  return {
    state: setupFailure?.state ?? state,
    ...(setupFailureCode ? { code: setupFailureCode } : {}),
    outcome,
  };
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
  if (execution.outcome)
    return {
      ...base,
      ...execution.outcome.result,
      ...(execution.outcome.result.state === 'completed' &&
      execution.completedAt &&
      ['preview_account_quarantine', 'preview_case_message_deletion'].includes(
        execution.command.kind
      )
        ? {
            previewReference: execution.executionId,
            previewExpiresAt:
              execution.command.kind === 'preview_account_quarantine'
                ? new Date(execution.completedAt.getTime() + 10 * 60 * 1000).toISOString()
                : null,
          }
        : {}),
    };
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
interface DelegatedActionServiceDependencies {
  readonly store: DelegationStore;
  readonly access: DelegatedAccess;
  readonly resolver: IntentResolver;
  readonly direct: DirectActionExecutor;
  readonly now?: () => number;
  readonly operations?: McpOperationalPort;
  readonly waitForExecution?: (
    work: Promise<PublicActionResult>,
    pending: () => PublicActionResult
  ) => Promise<PublicActionResult>;
}
function createCoreActionService(deps: DelegatedActionServiceDependencies): DelegatedActionService {
  const intents = createIntentService(deps);
  async function safe(work: () => Promise<PublicActionResult>): Promise<PublicActionResult> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof IntentError || error instanceof ActionDeniedError)
        return {
          state: 'denied',
          code: error.code,
          ...(error instanceof IntentError && error.retryAfterSeconds
            ? { retryAfterMs: error.retryAfterSeconds * 1000 }
            : {}),
        };
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
      deps.operations && !deps.operations.enabled()
        ? Promise.resolve({ kind: 'denied' as const, reason: 'mcp_disabled' })
        : deps.access.authorizeWorkflow(principal, execution.guildId, execution.command)
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
      try {
        await deps.store.completeExecution(execution.executionId, result);
      } catch {
        // The effect or completion write may have committed. Preserve the owned handle
        // for observation; neither a typed persistence denial nor a retry can undo it.
        return {
          ...projectExecution(admitted.execution),
          state: 'uncertain',
          code: 'completion_recording_failed',
        };
      }
      return { ...projectExecution(admitted.execution), ...result, retryAfterMs: undefined };
    })();
    return deps.waitForExecution
      ? deps.waitForExecution(work, () => projectExecution(admitted.execution))
      : work;
  }
  const service: DelegatedActionService = {
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
  return service;
}
/** Availability rejection is never a definitive intent denial. */
class OperationalAdmissionError extends Error {
  constructor(readonly result: PublicActionResult) {
    super('MCP operational admission unavailable.');
  }
}
export function createDelegatedActionService(
  deps: DelegatedActionServiceDependencies
): DelegatedActionService {
  if (!deps.operations) return createCoreActionService(deps);
  const operations = deps.operations;
  async function invoke(
    principal: DelegatedPrincipal,
    category: 'read' | 'submission',
    guildId: string | undefined,
    work: (
      service: DelegatedActionService,
      access: DelegatedAccess,
      chargeCaller: () => Promise<void>
    ) => Promise<PublicActionResult>,
    binding: Partial<IntentRecord> = {}
  ): Promise<PublicActionResult> {
    let charged = false;
    async function charge(decision?: AccessDecision): Promise<void> {
      if (charged) return;
      charged = true;
      if (decision?.kind === 'allowed' && guildId && decision.guildId !== guildId)
        throw new OperationalAdmissionError({ state: 'denied', code: 'binding_mismatch' });
      const accountingGuild = decision?.kind === 'allowed' ? decision.guildId : undefined;
      const budget = await operations.checkMcpLimit(
        { ...principal, guildId: accountingGuild },
        category
      );
      if (budget.kind === 'limited')
        throw new OperationalAdmissionError({
          state: 'denied',
          code: 'rate_limited',
          retryAfterMs: budget.retryAfterSeconds * 1000,
        });
    }
    async function authorize(pending: Promise<AccessDecision>): Promise<AccessDecision> {
      const decision = await pending;
      // Charge from the exact decision returned to core, before private resolution or effects.
      await charge(decision);
      return decision;
    }
    const access: DelegatedAccess = {
      ...deps.access,
      authorizeWorkflowId: (...args): Promise<AccessDecision> =>
        authorize(deps.access.authorizeWorkflowId(...args)),
      authorizeWorkflow: (...args): Promise<AccessDecision> =>
        authorize(deps.access.authorizeWorkflow(...args)),
      authorizeRead: (...args): Promise<AccessDecision> =>
        authorize(deps.access.authorizeRead(...args)),
    };
    let result: PublicActionResult;
    if (!operations.enabled()) result = { state: 'denied', code: 'mcp_disabled' };
    else {
      try {
        try {
          result = await work(createCoreActionService({ ...deps, access }), access, () => charge());
        } finally {
          await charge();
        } // Invalid/missing owned resources still count caller attempts.
      } catch (error) {
        if (!(error instanceof OperationalAdmissionError)) throw error;
        result = error.result;
      }
    }
    await operations
      .recordMcpAudit({
        event: category === 'read' ? 'observation' : 'admission',
        ...principal,
        guildId: result.guildId ?? guildId,
        workflowId: result.operation ?? binding.workflowId,
        confirmationMethod: binding.confirmationMethod ?? undefined,
        executionId: result.executionId,
        requestId: result.requestId,
        outcome:
          result.code === 'rate_limited'
            ? 'limited'
            : result.code === 'expired'
              ? 'expired'
              : result.code === 'cancelled'
                ? 'cancelled'
                : result.state,
      })
      .catch(() => undefined);
    return result;
  }
  async function saved(principal: DelegatedPrincipal, id: string): Promise<IntentRecord | null> {
    // Optional accounting context, never an authorization shortcut before confirm's durable denial.
    try {
      return await deps.store.loadIntent(principal, id);
    } catch {
      return null;
    }
  }
  return {
    submit: (principal, invocation) =>
      invoke(
        principal,
        [
          'preview_account_quarantine',
          'preview_case_message_deletion',
          'prepare_report_ban_review',
          'audit_integrity',
          'audit_case_role_lockdown',
        ].includes(invocation.workflowId) || record(invocation.input).mode === 'preview'
          ? 'read'
          : 'submission',
        invocation.guildId,
        (service) => service.submit(principal, invocation),
        { workflowId: invocation.workflowId }
      ),
    async confirm(principal, id, method): Promise<PublicActionResult> {
      const intent = await saved(principal, id);
      return invoke(
        principal,
        'submission',
        intent?.guildId,
        (service) => service.confirm(principal, id, method),
        { ...intent, confirmationMethod: method }
      );
    },
    async cancel(principal, id): Promise<PublicActionResult> {
      const intent = await saved(principal, id);
      return invoke(
        principal,
        'submission',
        intent?.guildId,
        async (service, access, chargeCaller) => {
          // Cancellation remains ownership-only; this decision supplies accounting context alone.
          if (intent) await access.authorizeWorkflow(principal, intent.guildId, intent.command);
          else await chargeCaller();
          return service.cancel(principal, id);
        },
        intent ?? {}
      );
    },
    async status(principal, id): Promise<PublicActionResult> {
      const execution = await deps.store.loadExecution(principal, id);
      return invoke(
        principal,
        'read',
        execution?.guildId,
        (service) => service.status(principal, id),
        execution ?? {}
      );
    },
  };
}
