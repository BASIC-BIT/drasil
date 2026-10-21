import { ActionDeniedError } from '../results';
import { approvedResetDelivery } from '../setup/resolution';
import { validateReportCaseTerminal } from '../reports/terminal';
import { createHash, randomBytes } from 'node:crypto';
import { workflowDefinitions, type HumanCommand } from './commands';
import { confirmationRequirement } from './confirmationPolicy';
import type { DelegatedAccess } from './access';
import { settingsSectionSchemas, type SetupServerRecord } from '../setup/settings';
import { queuedCommandSchema } from '../requests/commands';
import { encodeQueuedAction } from '../requests/encode';
import type {
  ConfirmationMethod,
  DelegatedPrincipal,
  ExecutionRecord,
  IntentDelivery,
  IntentInvocation,
  IntentRecord,
  IntentResolver,
  IntentStore,
  ResolvedIntent,
  IntentPreconditions,
  AuthorizedDelivery,
} from './types';

export class IntentError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'IntentError';
  }
}
/** Admission budget for exact human-visible summaries shared by every approval surface. */
export const INTENT_SUMMARY_BYTES = 16_384;
export function assertIntentSummary(summary: string): void {
  if (!summary.trim()) throw new IntentError('summary_required');
  if (Buffer.byteLength(JSON.stringify(summary), 'utf8') > INTENT_SUMMARY_BYTES)
    throw new IntentError('summary_too_large');
}
function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  throw new IntentError('invalid_canonical_value');
}
export function canonicalDigest(value: unknown): string {
  return `v1:sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;
}
const editableSettings = [
  ...new Set(Object.values(settingsSectionSchemas).flatMap((schema) => Object.keys(schema.shape))),
];
/** All seven editable columns and all canonical section keys; timestamps and unrelated
 * publication bookkeeping are excluded. Resolvers add workflow-specific policy/provenance. */
export function setupFingerprintState(record: SetupServerRecord): unknown {
  return {
    guild_id: record.guild_id,
    case_role_id: record.case_role_id,
    admin_channel_id: record.admin_channel_id,
    verification_channel_id: record.verification_channel_id,
    admin_notification_role_id: record.admin_notification_role_id,
    heuristic_message_threshold: record.heuristic_message_threshold,
    heuristic_message_timeframe_seconds: record.heuristic_message_timeframe_seconds,
    heuristic_suspicious_keywords: record.heuristic_suspicious_keywords,
    is_active: record.is_active,
    settings: Object.fromEntries(editableSettings.map((key) => [key, record.settings[key]])),
  };
}
export function assertIntentBinding(
  principal: DelegatedPrincipal,
  intent: Pick<IntentRecord, 'userId' | 'clientId' | 'connectionId' | 'grantVersion'>
): void {
  if (
    principal.userId !== intent.userId ||
    principal.clientId !== intent.clientId ||
    principal.connectionId !== intent.connectionId ||
    principal.grantVersion !== intent.grantVersion
  )
    throw new IntentError('binding_mismatch');
}
export function encodeIntentDelivery(intent: IntentRecord): IntentDelivery {
  if (intent.authorizedDelivery.kind === 'report_case_terminal') {
    validateReportCaseTerminal(intent, intent.authorizedDelivery.outcome);
    return { kind: 'report_case_terminal' };
  }
  if (intent.authorizedDelivery.kind === 'direct') return { kind: 'direct' };
  return encodeQueuedAction(
    {
      guildId: intent.guildId,
      requestId: intent.confirmationId,
      source: 'mcp',
      actor: { kind: 'user', userId: intent.userId },
    },
    intent.authorizedDelivery.command
  );
}

function boundPreviewExpiry(command: HumanCommand, precondition: IntentPreconditions): Date | null {
  switch (command.kind) {
    case 'execute_case_message_deletion':
    case 'ban_case_user_with_message_cleanup':
      if (
        precondition.kind !== 'cleanup_preview' ||
        precondition.jobId !== command.jobId ||
        precondition.jobId !== command.previewReference.jobId ||
        precondition.generation !== command.previewReference.generation
      )
        throw new IntentError('preview_required');
      return precondition.expiresAt;
    case 'quarantine_compromised_account':
      if (
        precondition.kind !== 'quarantine_preview' ||
        precondition.requestId !== command.previewReference.requestId ||
        !precondition.fingerprint
      )
        throw new IntentError('preview_required');
      return precondition.expiresAt;
    case 'review_uncertain_report_ban':
      if (
        precondition.kind !== 'report_ban_review' ||
        precondition.operationId !== command.operationId ||
        precondition.reviewReference !== command.reviewReference
      )
        throw new IntentError('preview_required');
      return precondition.expiresAt;
    default:
      return null;
  }
}

export interface IntentService {
  prepareIntent(principal: DelegatedPrincipal, invocation: IntentInvocation): Promise<IntentRecord>;
  acceptIntent(
    principal: DelegatedPrincipal,
    confirmationId: string,
    method: Exclude<ConfirmationMethod, 'not_required'>
  ): Promise<ExecutionRecord>;
  acceptWithoutConfirmation(
    principal: DelegatedPrincipal,
    confirmationId: string
  ): Promise<ExecutionRecord>;
  cancelIntent(principal: DelegatedPrincipal, confirmationId: string): Promise<IntentRecord | null>;
}
export function createIntentService(deps: {
  readonly store: IntentStore;
  readonly access: Pick<DelegatedAccess, 'authorizeWorkflowId' | 'authorizeWorkflow'>;
  readonly resolver: IntentResolver;
  readonly now?: () => number;
}): IntentService {
  const now = deps.now ?? Date.now;
  function normalize(invocation: IntentInvocation): IntentInvocation {
    const workflow = workflowDefinitions.find((item) => item.id === invocation.workflowId);
    if (
      !workflow ||
      !invocation.guildId ||
      !invocation.idempotencyKey ||
      invocation.idempotencyKey.length > 128
    )
      throw new IntentError('invalid_invocation');
    return { ...invocation, input: workflow.inputSchema.parse(invocation.input) };
  }
  async function resolve(
    principal: DelegatedPrincipal,
    invocation: IntentInvocation,
    previous?: ResolvedIntent
  ): Promise<ResolvedIntent> {
    const workflow = workflowDefinitions.find((item) => item.id === invocation.workflowId)!;
    const workflowAccess = await deps.access.authorizeWorkflowId(
      principal,
      invocation.guildId,
      workflow.id
    );
    if (workflowAccess.kind === 'denied') throw new IntentError(workflowAccess.reason);
    const resolution = await deps.resolver.resolve(
      principal,
      invocation,
      previous ? { kind: 'revalidate', previous } : undefined
    );
    const command = workflow.parseCommand(invocation.input, resolution.bindings);
    const access = await deps.access.authorizeWorkflow(principal, invocation.guildId, command);
    if (access.kind === 'denied') throw new IntentError(access.reason);
    if (resolution.delivery.kind === 'report_case_terminal')
      validateReportCaseTerminal(
        { workflowId: workflow.id, command, userId: principal.userId },
        resolution.delivery.outcome
      );
    if (
      resolution.delivery.kind !== 'report_case_terminal' &&
      resolution.delivery.kind !== workflow.delivery
    )
      throw new IntentError('delivery_mismatch');
    const delivery =
      resolution.delivery.kind !== 'queued'
        ? resolution.delivery
        : ((): AuthorizedDelivery => {
            const command = queuedCommandSchema.parse(resolution.delivery.command);
            return { kind: 'queued' as const, command, commandDigest: canonicalDigest(command) };
          })();
    if (delivery.kind === 'queued') {
      const matches =
        command.kind === 'open_submitted_report_case'
          ? delivery.command.kind === 'open_case_from_observed_detection' &&
            delivery.command.reportId === command.reportId &&
            delivery.command.origin === undefined
          : command.kind === 'reset_heuristics'
            ? approvedResetDelivery(command, delivery.command, resolution.preconditions)
            : delivery.commandDigest === canonicalDigest(command);
      if (!matches) throw new IntentError('delivery_mismatch');
    }
    if (
      workflow.confirmationRule === 'exact_settings_diff' &&
      resolution.preconditions.kind !== 'setup'
    )
      throw new IntentError('setup_state_required');
    if (
      resolution.preconditions.kind === 'setup' &&
      resolution.preconditions.approvedState.guild_id !== invocation.guildId
    )
      throw new IntentError('binding_mismatch');
    const boundExpiry = boundPreviewExpiry(command, resolution.preconditions);
    const previewExpiry = Math.min(
      boundExpiry?.getTime() ?? Infinity,
      resolution.previewExpiresAt?.getTime() ?? Infinity
    );
    const previewExpiresAt = previewExpiry === Infinity ? null : new Date(previewExpiry);
    const preconditions =
      resolution.preconditions.kind === 'setup'
        ? {
            kind: 'setup',
            approvedState: setupFingerprintState(resolution.preconditions.approvedState),
          }
        : resolution.preconditions;
    assertIntentSummary(resolution.summary);
    return {
      workflowId: invocation.workflowId,
      guildId: invocation.guildId,
      command,
      commandDigest: canonicalDigest(command),
      authorizedDelivery: delivery,
      preconditions: resolution.preconditions,
      stateFingerprint: canonicalDigest({
        preconditions,
        relevantState: resolution.relevantState,
        previewExpiresAt,
      }),
      summary: resolution.summary,
      previewExpiresAt,
    };
  }
  async function accept(
    principal: DelegatedPrincipal,
    confirmationId: string,
    method: ConfirmationMethod
  ): Promise<ExecutionRecord> {
    const intent = await deps.store.loadIntent(principal, confirmationId);
    if (!intent) throw new IntentError('not_found');
    assertIntentBinding(principal, intent);
    if (
      method === 'not_required' &&
      intent.authorizedDelivery.kind !== 'report_case_terminal' &&
      confirmationRequirement(intent.command) !== 'none'
    )
      throw new IntentError('confirmation_required');
    if (intent.state === 'consumed')
      return deps.store.acceptIntent(
        principal,
        confirmationId,
        method,
        encodeIntentDelivery(intent)
      );
    if (intent.state !== 'pending') throw new IntentError(intent.state);
    if (intent.expiresAt.getTime() <= now()) throw new IntentError('expired');
    let current: ResolvedIntent;
    try {
      assertIntentSummary(intent.summary);
      current = await resolve(principal, intent, intent);
      if (
        current.commandDigest !== intent.commandDigest ||
        current.stateFingerprint !== intent.stateFingerprint ||
        canonicalDigest(current.authorizedDelivery) !== canonicalDigest(intent.authorizedDelivery)
      )
        throw new IntentError('stale_state');
    } catch (error) {
      // Temporary resolver failures remain retryable; authoritative denials consume approval.
      if (
        (error instanceof IntentError || error instanceof ActionDeniedError) &&
        error.code !== 'unavailable'
      )
        await deps.store.denyIntent(principal, confirmationId);
      throw error;
    }
    return deps.store.acceptIntent(principal, confirmationId, method, encodeIntentDelivery(intent));
  }
  return {
    async prepareIntent(principal, input): Promise<IntentRecord> {
      const invocation = normalize(input);
      const invocationDigest = canonicalDigest({
        workflowId: invocation.workflowId,
        guildId: invocation.guildId,
        input: invocation.input,
      });
      const previous = await deps.store.findIntentByKey(principal, invocation.idempotencyKey);
      if (previous) {
        assertIntentBinding(principal, previous);
        if (previous.state === 'pending') {
          try {
            assertIntentSummary(previous.summary);
          } catch (error) {
            await deps.store.denyIntent(principal, previous.confirmationId);
            throw error;
          }
        }
        if (previous.invocationDigest !== invocationDigest)
          throw new IntentError('idempotency_conflict');
        const access = await deps.access.authorizeWorkflow(
          principal,
          previous.guildId,
          previous.command
        );
        if (access.kind === 'denied') {
          if (access.reason !== 'unavailable')
            await deps.store.denyIntent(principal, previous.confirmationId);
          throw new IntentError(access.reason);
        }
        return previous;
      }
      const resolved = await resolve(principal, invocation);
      const createdAt = new Date(now());
      const expiresAt = new Date(
        Math.min(
          createdAt.getTime() + 10 * 60_000,
          resolved.previewExpiresAt?.getTime() ?? Infinity
        )
      );
      if (expiresAt.getTime() <= createdAt.getTime()) throw new IntentError('expired');
      return deps.store.saveIntent(principal, {
        ...resolved,
        userId: principal.userId,
        clientId: principal.clientId,
        connectionId: principal.connectionId,
        grantVersion: principal.grantVersion,
        confirmationId: randomBytes(32).toString('base64url'),
        idempotencyKey: invocation.idempotencyKey,
        invocationDigest,
        input: invocation.input,
        createdAt,
        expiresAt,
        state: 'pending',
        confirmationMethod: null,
        executionId: null,
      });
    },
    acceptIntent: (principal, confirmationId, method): Promise<ExecutionRecord> => {
      if (!['elicitation', 'client_confirmation', 'website', 'discord'].includes(method))
        return Promise.reject(new IntentError('confirmation_required'));
      return accept(principal, confirmationId, method);
    },
    acceptWithoutConfirmation: (principal, confirmationId) =>
      accept(principal, confirmationId, 'not_required'),
    cancelIntent: (principal, confirmationId) => deps.store.cancelIntent(principal, confirmationId),
  };
}
