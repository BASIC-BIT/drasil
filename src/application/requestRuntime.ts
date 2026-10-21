import {
  decodeQueuedAction,
  ActionDeniedError,
  isQueuedOperationCommand,
  isQueuedReportCommand,
  isQueuedSetupCommand,
  isQueuedMessageCleanupCommand,
  operationConfirmationCommand,
  operationNeedsConfirmation,
  type DecodedQueuedAction,
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
  readonly state: 'denied' | 'uncertain';
  readonly code?: string;
};
export interface PreparedQueuedRequest {
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
      execute: async () => ({
        action_type: 'delegated_admission',
        state: 'denied',
        code: admission.code,
      }),
    };
  if (admission.kind === 'already_bound')
    return {
      execute: async () => ({
        action_type: 'delegated_admission',
        state: 'uncertain',
        code: 'already_started',
      }),
    };
  const onComplete: PreparedQueuedRequest['onComplete'] =
    delegation &&
    (admission.kind === 'new_execution' || admission.kind === 'committed_reconciliation')
      ? (outcome): Promise<void> => delegation.complete(admission.execution, outcome)
      : undefined;
  const { command } = decoded;
  let action = decoded;
  if (recovery) {
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
  const dispatch = prepareQueuedAction({ runtime, action, request });
  const execute: PreparedQueuedRequest['execute'] =
    admission.kind === 'ordinary'
      ? dispatch
      : async (): Promise<QueuedActionOutcome | DelegatedWorkerOutcome> => {
          try {
            return await dispatch();
          } catch (error) {
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
