import { dispatchSetupAction, type QueuedSetupOutcome } from './setupDispatch';
import { dispatchReportAction, type QueuedReportOutcome } from './reportDispatch';
import { dispatchOperationsAction, type QueuedOperationsOutcome } from './operationsDispatch';
import {
  dispatchMessageCleanupAction,
  type QueuedMessageCleanupOutcome,
} from './messageCleanupDispatch';
import { requireCaptchaOutcome } from './adapters/captcha';
import {
  type QueuedCommand,
  type ActionContext,
  type CaptchaOutcome,
  type CaseCommand,
  type CaseOutcome,
  type DecodedQueuedAction,
} from '@drasil/application';
import { dispatchQuarantineAction, type QueuedQuarantineOutcome } from './quarantineDispatch';
import { dispatchDetectionAction, type QueuedDetectionOutcome } from './detectionDispatch';
import type { BotApplication } from './createBotApplication';
import { requireCaseOutcome } from './adapters/cases';

type CaseReceipt = { readonly target_user_id: string; readonly verification_event_id: string };
export type QueuedActionOutcome =
  | QueuedSetupOutcome
  | QueuedReportOutcome
  | QueuedOperationsOutcome
  | QueuedMessageCleanupOutcome
  | CaptchaOutcome
  | QueuedQuarantineOutcome
  | QueuedDetectionOutcome
  | {
      readonly action_type: 'open_case_from_observed_detection';
      readonly target_user_id: string;
      readonly detection_event_id: string;
      readonly opened: boolean;
    }
  | {
      readonly action_type: 'open_admin_case';
      readonly target_user_id: string;
      readonly detection_event_id: string | null;
      readonly opened: boolean;
      readonly case_role_active: boolean;
      readonly case_role_attempted: boolean;
      readonly source_channel_id: string | null;
      readonly source_message_id: string | null;
      readonly source_message_fetched: boolean;
    }
  | {
      readonly action_type: 'manual_flag_user';
      readonly target_user_id: string;
      readonly flagged: boolean;
    }
  | (CaseReceipt &
      (
        | { readonly action_type: 'verify_case_user'; readonly verified: boolean }
        | { readonly action_type: 'close_case_no_action'; readonly closed_count: number }
        | { readonly action_type: 'kick_case_user'; readonly kicked: boolean }
        | {
            readonly action_type: 'ban_case_user' | 'ban_case_user_by_id';
            readonly banned: boolean;
          }
        | {
            readonly action_type: 'repair_active_case';
            readonly message: string;
            readonly repaired: boolean;
            readonly thread_created: boolean;
          }
        | { readonly action_type: 'reopen_case'; readonly reopened: boolean }
        | {
            readonly action_type: 'refresh_case_notification';
            readonly message: string;
            readonly refreshed: boolean;
            readonly notification_channel_id: string | null;
            readonly notification_message_id: string | null;
            readonly status: string | null;
          }
        | { readonly action_type: 'sync_existing_ban'; readonly synced_count: number }
      ));
export type QueuedHandler = (
  application: BotApplication,
  action: DecodedQueuedAction
) => Promise<QueuedActionOutcome>;

function handler<K extends QueuedCommand['kind']>(
  kind: K,
  execute: (
    application: BotApplication,
    context: ActionContext,
    command: Extract<QueuedCommand, { kind: K }>
  ) => Promise<QueuedActionOutcome>
): QueuedHandler {
  return (application, action) => {
    if (action.command.kind !== kind) throw new Error('Queued handler binding mismatch.');
    // TypeScript cannot narrow a discriminated union against a generic parameter.
    return execute(
      application,
      action.context,
      action.command as Extract<QueuedCommand, { kind: K }>
    );
  };
}
export const queuedActionHandlers = {
  open_case_from_observed_detection: handler(
    'open_case_from_observed_detection',
    (application, context, command) => dispatchCaseAction(application, context, command)
  ),
  open_admin_case: handler('open_admin_case', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  manual_flag_user: handler('manual_flag_user', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  verify_case_user: handler('verify_case_user', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  close_case_no_action: handler('close_case_no_action', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  kick_case_user: handler('kick_case_user', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  ban_case_user: handler('ban_case_user', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  ban_case_user_by_id: handler('ban_case_user_by_id', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  repair_active_case: handler('repair_active_case', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  reopen_case: handler('reopen_case', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  refresh_case_notification: handler('refresh_case_notification', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  sync_existing_ban: handler('sync_existing_ban', (application, context, command) =>
    dispatchCaseAction(application, context, command)
  ),
  dismiss_observed_detection: handler(
    'dismiss_observed_detection',
    (application, context, command) =>
      dispatchDetectionAction(application.detections, context, command)
  ),
  mark_observed_detection_false_positive: handler(
    'mark_observed_detection_false_positive',
    (application, context, command) =>
      dispatchDetectionAction(application.detections, context, command)
  ),
  undo_observed_detection_action: handler(
    'undo_observed_detection_action',
    (application, context, command) =>
      dispatchDetectionAction(application.detections, context, command)
  ),
  kick_observed_detection: handler('kick_observed_detection', (application, context, command) =>
    dispatchDetectionAction(application.detections, context, command)
  ),
  ban_observed_detection: handler('ban_observed_detection', (application, context, command) =>
    dispatchDetectionAction(application.detections, context, command)
  ),
  ignore_detection_accounting: handler(
    'ignore_detection_accounting',
    (application, context, command) =>
      dispatchDetectionAction(application.detections, context, command)
  ),
  restore_detection_accounting: handler(
    'restore_detection_accounting',
    (application, context, command) =>
      dispatchDetectionAction(application.detections, context, command)
  ),
  preview_account_quarantine: handler(
    'preview_account_quarantine',
    (application, context, command) =>
      dispatchQuarantineAction(application.quarantine, context, command)
  ),
  quarantine_compromised_account: handler(
    'quarantine_compromised_account',
    (application, context, command) =>
      dispatchQuarantineAction(application.quarantine, context, command)
  ),
  request_captcha_challenge: handler(
    'request_captcha_challenge',
    async (application, context, command) =>
      requireCaptchaOutcome(await application.captcha.execute(context, command))
  ),
  retry_captcha_challenge: handler(
    'retry_captcha_challenge',
    async (application, context, command) =>
      requireCaptchaOutcome(await application.captcha.execute(context, command))
  ),
  bypass_captcha_challenge: handler(
    'bypass_captcha_challenge',
    async (application, context, command) =>
      requireCaptchaOutcome(await application.captcha.execute(context, command))
  ),
  apply_captcha_pass: handler('apply_captcha_pass', async (application, context, command) =>
    requireCaptchaOutcome(await application.captcha.execute(context, command))
  ),
  notify_captcha_attention: handler(
    'notify_captcha_attention',
    async (application, context, command) =>
      requireCaptchaOutcome(await application.captcha.execute(context, command))
  ),
  preview_case_message_deletion: handler(
    'preview_case_message_deletion',
    (application, context, command) =>
      dispatchMessageCleanupAction(application.messageCleanup, context, command)
  ),
  execute_case_message_deletion: handler(
    'execute_case_message_deletion',
    (application, context, command) =>
      dispatchMessageCleanupAction(application.messageCleanup, context, command)
  ),
  ban_case_user_with_message_cleanup: handler(
    'ban_case_user_with_message_cleanup',
    (application, context, command) =>
      dispatchMessageCleanupAction(application.messageCleanup, context, command)
  ),
  sync_moderation_queue: handler('sync_moderation_queue', (application, context, command) =>
    dispatchOperationsAction(application.operations, context, command)
  ),
  clear_moderation_queue: handler('clear_moderation_queue', (application, context, command) =>
    dispatchOperationsAction(application.operations, context, command)
  ),
  close_resolved_case_threads: handler(
    'close_resolved_case_threads',
    (application, context, command) =>
      dispatchOperationsAction(application.operations, context, command)
  ),
  audit_case_role_lockdown: handler('audit_case_role_lockdown', (application, context, command) =>
    dispatchOperationsAction(application.operations, context, command)
  ),
  apply_case_role_lockdown: handler('apply_case_role_lockdown', (application, context, command) =>
    dispatchOperationsAction(application.operations, context, command)
  ),
  intake_role_members: handler('intake_role_members', (application, context, command) =>
    dispatchOperationsAction(application.operations, context, command)
  ),
  submit_user_report: handler('submit_user_report', (application, context, command) =>
    dispatchReportAction(application.reports, context, command)
  ),
  start_report_intake: handler('start_report_intake', (application, context, command) =>
    dispatchReportAction(application.reports, context, command)
  ),
  close_report_intake: handler('close_report_intake', (application, context, command) =>
    dispatchReportAction(application.reports, context, command)
  ),
  complete_setup_verification: handler(
    'complete_setup_verification',
    (application, context, command) =>
      dispatchSetupAction(application.setupRuntime, context, command)
  ),
  upsert_report_instructions: handler(
    'upsert_report_instructions',
    (application, context, command) =>
      dispatchSetupAction(application.setupRuntime, context, command)
  ),
} satisfies Record<QueuedCommand['kind'], QueuedHandler>;

export function dispatchQueuedAction(
  application: BotApplication,
  action: DecodedQueuedAction
): Promise<QueuedActionOutcome> {
  return queuedActionHandlers[action.command.kind](application, action);
}
async function dispatchCaseAction(
  application: BotApplication,
  context: ActionContext,
  command: CaseCommand
): Promise<QueuedActionOutcome> {
  const outcome = requireCaseOutcome(await application.cases.execute(context, command));
  const target = { target_user_id: command.targetUserId };
  switch (outcome.kind) {
    case 'open_case_from_observed_detection': {
      if (command.kind !== outcome.kind) throw new Error('Case outcome mismatch.');
      return {
        ...target,
        action_type: outcome.kind,
        detection_event_id: command.detectionEventId,
        opened: outcome.succeeded,
      };
    }
    case 'open_admin_case': {
      if (command.kind !== outcome.kind) throw new Error('Case outcome mismatch.');
      return {
        ...target,
        action_type: outcome.kind,
        detection_event_id: command.detectionEventId,
        opened: outcome.result.opened,
        case_role_active: outcome.result.caseRoleActive,
        case_role_attempted: outcome.result.caseRoleAttempted,
        source_channel_id: command.selectedMessage?.channelId ?? null,
        source_message_id: command.selectedMessage?.messageId ?? null,
        source_message_fetched: outcome.result.sourceMessageFetched ?? false,
      };
    }
    case 'manual_flag_user':
      return { ...target, action_type: outcome.kind, flagged: outcome.succeeded };
    case 'ban_user':
    case 'kick_user':
      throw new Error('Ordinary staff actions execute directly.');
    default: {
      return projectBoundReceipt(command, outcome);
    }
  }
}
function projectBoundReceipt(
  command: CaseCommand,
  outcome: Exclude<
    CaseOutcome,
    {
      kind:
        | 'open_case_from_observed_detection'
        | 'open_admin_case'
        | 'manual_flag_user'
        | 'ban_user'
        | 'kick_user';
    }
  >
): QueuedActionOutcome {
  const bound = {
    target_user_id: command.targetUserId,
    verification_event_id: boundCaseId(command),
  };
  switch (outcome.kind) {
    case 'verify_case_user':
      return { ...bound, action_type: outcome.kind, verified: outcome.succeeded };
    case 'close_case_no_action':
      return { ...bound, action_type: outcome.kind, closed_count: outcome.count };
    case 'kick_case_user':
      return { ...bound, action_type: outcome.kind, kicked: outcome.succeeded };
    case 'ban_case_user':
    case 'ban_case_user_by_id':
      return { ...bound, action_type: outcome.kind, banned: outcome.succeeded };
    case 'repair_active_case':
      return {
        ...bound,
        action_type: outcome.kind,
        message: outcome.result.message,
        repaired: outcome.result.repaired,
        thread_created: outcome.result.threadCreated,
      };
    case 'reopen_case':
      return { ...bound, action_type: outcome.kind, reopened: outcome.succeeded };
    case 'refresh_case_notification':
      return {
        ...bound,
        action_type: outcome.kind,
        message: outcome.result.message,
        refreshed: outcome.result.refreshed,
        notification_channel_id: outcome.result.notificationChannelId ?? null,
        notification_message_id: outcome.result.notificationMessageId ?? null,
        status: outcome.result.status ?? null,
      };
    case 'sync_existing_ban':
      return { ...bound, action_type: outcome.kind, synced_count: outcome.count };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function boundCaseId(command: CaseCommand): string {
  if (!('caseId' in command)) throw new Error('Case receipt requires a bound command.');
  return command.caseId;
}
