import {
  decodeQueuedAction,
  isQueuedCaptchaCommand,
  isQueuedOperationCommand,
  isQueuedReportCommand,
  isQueuedSetupCommand,
  isQueuedMessageCleanupCommand,
  operationConfirmationCommand,
  operationNeedsConfirmation,
  type DecodedQueuedAction,
} from '@drasil/application';
import type { BotApplication } from './createBotApplication';
import type { ModerationActionRequest } from '../repositories/types';
import type { IProductAnalyticsService } from '../services/ProductAnalyticsService';

interface QueuedExecution {
  readonly application: BotApplication;
  readonly action: DecodedQueuedAction;
  readonly afterComplete?: () => Promise<void>;
}

/** Persisted leases, challenge credentials and ban attempt fencing stay in this bot envelope. */
export async function prepareQueuedRequest(
  application: BotApplication,
  request: ModerationActionRequest,
  analytics: IProductAnalyticsService,
  recovery: boolean
): Promise<QueuedExecution> {
  const execution = await bindRequestRuntime(application, request, analytics);
  const { command } = execution.action;
  if (recovery) {
    if (command.kind !== 'ban_observed_detection')
      throw new Error('Only report-ban operations can enter reconciliation.');
    return {
      ...execution,
      action: {
        ...execution.action,
        context: {
          ...execution.action.context,
          actor: { kind: 'system', purpose: 'report_ban_recovery' },
        },
      },
    };
  }
  if (
    execution.action.context.actor.kind === 'user' &&
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
    application.caseConfirmations.recordVerified(
      execution.action.context,
      isQueuedOperationCommand(command)
        ? operationConfirmationCommand(execution.action.context, command)
        : command
    );
  }
  return execution;
}

async function bindRequestRuntime(
  application: BotApplication,
  request: ModerationActionRequest,
  analytics: IProductAnalyticsService
): Promise<QueuedExecution> {
  // Shipped cleanup rows may need the persisted job snapshot before decoding.
  if (
    request.action_type === 'preview_case_message_deletion' ||
    request.action_type === 'execute_case_message_deletion' ||
    request.action_type === 'ban_case_user_with_message_cleanup'
  ) {
    const runtime = application.messageCleanupRuntime;
    return {
      application: { ...application, messageCleanup: runtime.forRequest(request) },
      action: await runtime.decodeRequest(request),
      afterComplete: () => runtime.afterComplete(request),
    };
  }
  const action = decodeQueuedAction(request);
  if (isQueuedCaptchaCommand(action.command))
    return {
      application: { ...application, captcha: application.captchaRuntime.forRequest(request) },
      action: await application.captchaRuntime.decodeRequest(request),
    };
  if (
    action.command.kind === 'preview_account_quarantine' ||
    action.command.kind === 'quarantine_compromised_account'
  )
    return {
      application: {
        ...application,
        quarantine: application.quarantineRuntime.forRequest(request),
      },
      action,
    };
  if (action.command.kind === 'complete_setup_verification' && action.command.onboardingWizard)
    return {
      application,
      action,
      afterComplete: async (): Promise<void> => {
        void analytics.captureGuildEvent(request.server_id, 'setup wizard completed', {
          surface: 'web',
        });
      },
    };
  return {
    application: { ...application, detections: application.detectionRuntime.forRequest(request) },
    action,
  };
}
