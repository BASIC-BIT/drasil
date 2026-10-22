import { ReportInstructionsRollbackRequiredError } from '../controllers/ReportInstructionsManager';
import { SetupEffectsStateChangedError } from './adapters/approvedSetup';
import {
  decodeQueuedAction,
  workflowDefinitions,
  ActionDeniedError,
  isQueuedOperationCommand,
  isQueuedReportCommand,
  isQueuedSetupCommand,
  isQueuedMessageCleanupCommand,
  operationConfirmationCommand,
  operationNeedsConfirmation,
  type DecodedQueuedAction,
  type QuarantineActions,
  type MessageCleanupActions,
  type ActionCompletion,
} from '@drasil/application';
import {
  prepareQueuedAction,
  type QueuedActionOutcome,
  type QueuedRequestRuntime,
} from './requestDispatch';
import type { ModerationActionRequest } from '../repositories/types';
import type { IProductAnalyticsService } from '../services/ProductAnalyticsService';

export type DelegatedWorkerOutcome = {
  readonly action_type: 'delegated_admission';
  readonly state: ActionCompletion['state'];
  readonly outcome?: { readonly succeeded: boolean };
  readonly code?: string;
};
export interface PreparedQueuedRequest {
  /** A validated replay observes the original execution without becoming its writer. */
  readonly persistence?: 'observe_only';
  execute(): Promise<QueuedActionOutcome | DelegatedWorkerOutcome>;
  onComplete?: (outcome: unknown) => Promise<void>;
  afterComplete?: () => Promise<void>;
}

/** Persisted leases, challenge credentials and ban attempt fencing stay in this bot envelope. */
export async function prepareQueuedRequest(input: {
  readonly runtime: QueuedRequestRuntime;
  readonly request: ModerationActionRequest;
  readonly analytics: IProductAnalyticsService;
  readonly recovery?: boolean;
}): Promise<PreparedQueuedRequest> {
  const { runtime, request, analytics, recovery } = input;
  const decoded = await decodeRequest(runtime, request);
  const delegation = runtime.delegation;
  const admission = delegation
    ? await delegation.authorizeDelegatedRequest(request, recovery === true, decoded)
    : request.actor_surface === 'mcp' ||
        Object.prototype.hasOwnProperty.call(request.metadata ?? {}, 'delegation')
      ? { kind: 'denied' as const, code: 'delegation_unavailable' }
      : { kind: 'ordinary' as const };
  if (admission.kind === 'denied')
    return {
      ...(admission.persistence ? { persistence: admission.persistence } : {}),
      execute: async () => ({
        action_type: 'delegated_admission',
        state: 'denied',
        code: admission.code,
      }),
    };
  if (admission.kind === 'already_bound')
    return {
      persistence: 'observe_only',
      execute: async (): Promise<DelegatedWorkerOutcome> => {
        const native =
          decoded.command.kind === 'ban_user' || decoded.command.kind === 'kick_user'
            ? await delegation?.reconcileNativeEnforcement?.(admission.execution.executionId)
            : null;
        return {
          action_type: 'delegated_admission',
          state:
            native?.state === 'completed' ||
            native?.state === 'denied' ||
            native?.state === 'partial' ||
            native?.state === 'failed'
              ? native.state
              : 'uncertain',
          code: native?.code ?? 'already_started',
          ...(typeof native?.outcome?.succeeded === 'boolean'
            ? { outcome: { succeeded: native.outcome.succeeded } }
            : {}),
        };
      },
    };
  const onComplete: PreparedQueuedRequest['onComplete'] =
    delegation &&
    (admission.kind === 'new_execution' ||
      admission.kind === 'committed_reconciliation' ||
      admission.kind === 'committed_containment')
      ? (outcome): Promise<void> => delegation.complete(admission.execution, outcome)
      : undefined;
  const { command } = decoded;
  let action = decoded;
  if (recovery && admission.kind !== 'committed_containment') {
    if (command.kind !== 'ban_observed_detection')
      throw new Error('Only report-ban operations can enter reconciliation.');
    action = {
      ...decoded,
      context: {
        ...decoded.context,
        actor: { kind: 'system', purpose: 'report_ban_recovery' },
      },
    };
  } else if (
    action.context.actor.kind === 'user' &&
    !isQueuedReportCommand(command) &&
    !isQueuedSetupCommand(command) &&
    !isQueuedMessageCleanupCommand(command) &&
    command.kind !== 'repair_active_case' &&
    command.kind !== 'refresh_case_notification' &&
    (!isQueuedOperationCommand(command) || operationNeedsConfirmation(command)) &&
    command.kind !== 'preview_account_quarantine' &&
    command.kind !== 'quarantine_compromised_account'
  ) {
    // Accepted persisted submissions supply evidence; shared actions still enforce
    // current authority, policy and subject binding at execution.
    runtime.caseConfirmations.recordVerified(
      action.context,
      isQueuedOperationCommand(command)
        ? operationConfirmationCommand(action.context, command)
        : command
    );
  }
  const caseRuntime =
    admission.kind === 'new_execution' &&
    runtime.casesForExecution &&
    workflowDefinitions.some(
      (entry) => entry.id === admission.execution.workflowId && entry.family === 'cases'
    )
      ? { ...runtime, cases: runtime.casesForExecution(admission.execution) }
      : runtime;
  if (
    admission.kind === 'new_execution' &&
    workflowDefinitions.some(
      (entry) => entry.id === admission.execution.workflowId && entry.family === 'cases'
    ) &&
    !runtime.casesForExecution
  )
    return {
      execute: async () => ({
        action_type: 'delegated_admission',
        state: 'denied',
        code: 'case_runtime_unavailable',
      }),
      onComplete,
    };
  let scopedRuntime = caseRuntime;
  if (admission.kind === 'new_execution' || admission.kind === 'committed_containment') {
    const committedOnly = admission.kind === 'committed_containment';
    const family = workflowDefinitions.find(
      (entry) => entry.id === admission.execution.workflowId
    )?.family;
    if (family === 'captcha')
      scopedRuntime = {
        ...scopedRuntime,
        captchaRuntime: runtime.captchaRuntime.forExecution(admission.execution, committedOnly),
      };
    if (committedOnly && family === 'quarantine')
      scopedRuntime = {
        ...scopedRuntime,
        quarantineRuntime: {
          ...runtime.quarantineRuntime,
          forRequest: (r): QuarantineActions => runtime.quarantineRuntime.forCommittedRequest(r),
        },
      };
    if (committedOnly && family === 'cleanup')
      scopedRuntime = {
        ...scopedRuntime,
        messageCleanupRuntime: {
          ...runtime.messageCleanupRuntime,
          forRequest: (r): MessageCleanupActions =>
            runtime.messageCleanupRuntime.forCommittedRequest(r),
        },
      };
    if (family === 'setup')
      scopedRuntime = {
        ...caseRuntime,
        setupRuntime: runtime.setupRuntime.forExecution(admission.execution),
      };
    if (family === 'operations')
      scopedRuntime = {
        ...caseRuntime,
        operations: runtime.operationsRuntime.forExecution(admission.execution),
      };
  }
  const dispatch = prepareQueuedAction({ runtime: scopedRuntime, action, request });
  const execute: PreparedQueuedRequest['execute'] =
    admission.kind === 'ordinary'
      ? dispatch
      : async (): Promise<QueuedActionOutcome | DelegatedWorkerOutcome> => {
          try {
            if (
              admission.kind === 'new_execution' &&
              [
                'open_submitted_report_case',
                'confirm_intake_candidate',
                'reject_intake_candidates',
                'submit_message_report',
              ].includes(admission.execution.workflowId)
            ) {
              if (!delegation?.validateReportResources)
                throw new ActionDeniedError('report_runtime_unavailable');
              await delegation.validateReportResources(admission.execution);
            }
            return await dispatch();
          } catch (error) {
            if (
              isQueuedSetupCommand(command) &&
              error instanceof ReportInstructionsRollbackRequiredError
            )
              return {
                action_type: 'delegated_admission',
                state: 'uncertain',
                code: 'report_panel_recovery_required',
              };
            if (error instanceof SetupEffectsStateChangedError)
              return {
                action_type: 'delegated_admission',
                state: 'uncertain',
                code: 'stale_state_after_external_effects',
              };
            if (command.kind === 'ban_user' || command.kind === 'kick_user') {
              const receipt = await delegation?.reconcileNativeEnforcement?.(
                admission.execution.executionId
              );
              if (receipt?.code === 'execution_interrupted_before_send')
                return {
                  action_type: 'delegated_admission',
                  state: error instanceof ActionDeniedError ? 'denied' : 'failed',
                  code: error instanceof ActionDeniedError ? error.code : receipt.code,
                };
              return {
                action_type: 'delegated_admission',
                state: receipt?.state === 'partial' ? 'partial' : 'uncertain',
                code: receipt?.code ?? 'native_outcome_unknown',
              };
            }
            if (error instanceof ActionDeniedError)
              return { action_type: 'delegated_admission', state: 'denied', code: error.code };
            throw error;
          }
        };
  if (isQueuedMessageCleanupCommand(command))
    return {
      execute,
      onComplete,
      afterComplete: () => runtime.messageCleanupRuntime.afterComplete(request),
    };
  if (command.kind === 'complete_setup_verification' && command.onboardingWizard)
    return {
      execute,
      onComplete,
      afterComplete: async (): Promise<void> => {
        void analytics.captureGuildEvent(request.server_id, 'setup wizard completed', {
          surface: 'web',
        });
      },
    };
  return { execute, onComplete };
}

async function decodeRequest(
  runtime: QueuedRequestRuntime,
  request: ModerationActionRequest
): Promise<DecodedQueuedAction> {
  switch (request.action_type) {
    // Shipped cleanup rows may need the persisted job snapshot before decoding.
    case 'preview_case_message_deletion':
    case 'execute_case_message_deletion':
    case 'ban_case_user_with_message_cleanup':
      return runtime.messageCleanupRuntime.decodeRequest(request);
    case 'request_captcha_challenge':
    case 'retry_captcha_challenge':
    case 'bypass_captcha_challenge':
    case 'apply_captcha_pass':
    case 'notify_captcha_attention':
      return runtime.captchaRuntime.decodeRequest(request);
    default:
      return decodeQueuedAction(request);
  }
}
