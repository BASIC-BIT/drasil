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
import type { ModerationActionRequest } from '../repositories/types';
import { requireCaseOutcome } from './adapters/cases';

type CaseReceipt = { readonly target_user_id: string; readonly verification_event_id: string };
export type QueuedActionOutcome =
  | {
      readonly action_type: 'ban_user' | 'kick_user';
      readonly target_user_id: string;
      readonly succeeded: boolean;
    }
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
export type QueuedRequestRuntime = Pick<
  BotApplication,
  | 'delegation'
  | 'casesForExecution'
  | 'cases'
  | 'reports'
  | 'operations'
  | 'setupRuntime'
  | 'caseConfirmations'
  | 'captchaRuntime'
  | 'messageCleanupRuntime'
  | 'quarantineRuntime'
  | 'detectionRuntime'
>;
export interface QueuedDispatchInput {
  readonly runtime: QueuedRequestRuntime;
  readonly action: DecodedQueuedAction;
  readonly request: ModerationActionRequest;
}
export type QueuedHandler = (input: QueuedDispatchInput) => () => Promise<QueuedActionOutcome>;

function handler<K extends QueuedCommand['kind'], Actions>(
  kind: K,
  select: (runtime: QueuedRequestRuntime, request: ModerationActionRequest) => Actions,
  execute: (
    actions: Actions,
    context: ActionContext,
    command: Extract<QueuedCommand, { kind: K }>
  ) => Promise<QueuedActionOutcome>
): QueuedHandler {
  return ({ runtime, action, request }) => {
    if (action.command.kind !== kind) throw new Error('Queued handler binding mismatch.');
    const actions = select(runtime, request);
    // TypeScript cannot narrow a discriminated union against a generic parameter.
    const command = action.command as Extract<QueuedCommand, { kind: K }>;
    return () => execute(actions, action.context, command);
  };
}
export const queuedActionHandlers = {
  ban_user: handler('ban_user', (runtime) => runtime.cases, dispatchCaseAction),
  kick_user: handler('kick_user', (runtime) => runtime.cases, dispatchCaseAction),
  open_case_from_observed_detection: handler(
    'open_case_from_observed_detection',
    (runtime) => runtime.cases,
    dispatchCaseAction
  ),
  open_admin_case: handler('open_admin_case', (runtime) => runtime.cases, dispatchCaseAction),
  manual_flag_user: handler('manual_flag_user', (runtime) => runtime.cases, dispatchCaseAction),
  verify_case_user: handler('verify_case_user', (runtime) => runtime.cases, dispatchCaseAction),
  close_case_no_action: handler(
    'close_case_no_action',
    (runtime) => runtime.cases,
    dispatchCaseAction
  ),
  kick_case_user: handler('kick_case_user', (runtime) => runtime.cases, dispatchCaseAction),
  ban_case_user: handler('ban_case_user', (runtime) => runtime.cases, dispatchCaseAction),
  ban_case_user_by_id: handler(
    'ban_case_user_by_id',
    (runtime) => runtime.cases,
    dispatchCaseAction
  ),
  repair_active_case: handler('repair_active_case', (runtime) => runtime.cases, dispatchCaseAction),
  reopen_case: handler('reopen_case', (runtime) => runtime.cases, dispatchCaseAction),
  refresh_case_notification: handler(
    'refresh_case_notification',
    (runtime) => runtime.cases,
    dispatchCaseAction
  ),
  sync_existing_ban: handler('sync_existing_ban', (runtime) => runtime.cases, dispatchCaseAction),
  dismiss_observed_detection: handler(
    'dismiss_observed_detection',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  mark_observed_detection_false_positive: handler(
    'mark_observed_detection_false_positive',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  undo_observed_detection_action: handler(
    'undo_observed_detection_action',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  kick_observed_detection: handler(
    'kick_observed_detection',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  ban_observed_detection: handler(
    'ban_observed_detection',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  ignore_detection_accounting: handler(
    'ignore_detection_accounting',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  restore_detection_accounting: handler(
    'restore_detection_accounting',
    (runtime, request) => runtime.detectionRuntime.forRequest(request),
    dispatchDetectionAction
  ),
  preview_account_quarantine: handler(
    'preview_account_quarantine',
    (runtime, request) => runtime.quarantineRuntime.forRequest(request),
    dispatchQuarantineAction
  ),
  quarantine_compromised_account: handler(
    'quarantine_compromised_account',
    (runtime, request) => runtime.quarantineRuntime.forRequest(request),
    dispatchQuarantineAction
  ),
  request_captcha_challenge: handler(
    'request_captcha_challenge',
    (runtime, request) => runtime.captchaRuntime.forRequest(request),
    async (actions, context, command) =>
      requireCaptchaOutcome(await actions.execute(context, command))
  ),
  retry_captcha_challenge: handler(
    'retry_captcha_challenge',
    (runtime, request) => runtime.captchaRuntime.forRequest(request),
    async (actions, context, command) =>
      requireCaptchaOutcome(await actions.execute(context, command))
  ),
  bypass_captcha_challenge: handler(
    'bypass_captcha_challenge',
    (runtime, request) => runtime.captchaRuntime.forRequest(request),
    async (actions, context, command) =>
      requireCaptchaOutcome(await actions.execute(context, command))
  ),
  apply_captcha_pass: handler(
    'apply_captcha_pass',
    (runtime, request) => runtime.captchaRuntime.forRequest(request),
    async (actions, context, command) =>
      requireCaptchaOutcome(await actions.execute(context, command))
  ),
  notify_captcha_attention: handler(
    'notify_captcha_attention',
    (runtime, request) => runtime.captchaRuntime.forRequest(request),
    async (actions, context, command) =>
      requireCaptchaOutcome(await actions.execute(context, command))
  ),
  preview_case_message_deletion: handler(
    'preview_case_message_deletion',
    (runtime, request) => runtime.messageCleanupRuntime.forRequest(request),
    dispatchMessageCleanupAction
  ),
  execute_case_message_deletion: handler(
    'execute_case_message_deletion',
    (runtime, request) => runtime.messageCleanupRuntime.forRequest(request),
    dispatchMessageCleanupAction
  ),
  ban_case_user_with_message_cleanup: handler(
    'ban_case_user_with_message_cleanup',
    (runtime, request) => runtime.messageCleanupRuntime.forRequest(request),
    dispatchMessageCleanupAction
  ),
  sync_moderation_queue: handler(
    'sync_moderation_queue',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  clear_moderation_queue: handler(
    'clear_moderation_queue',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  close_resolved_case_threads: handler(
    'close_resolved_case_threads',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  audit_case_role_lockdown: handler(
    'audit_case_role_lockdown',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  apply_case_role_lockdown: handler(
    'apply_case_role_lockdown',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  intake_role_members: handler(
    'intake_role_members',
    (runtime) => runtime.operations,
    dispatchOperationsAction
  ),
  submit_user_report: handler(
    'submit_user_report',
    (runtime) => runtime.reports,
    dispatchReportAction
  ),
  start_report_intake: handler(
    'start_report_intake',
    (runtime) => runtime.reports,
    dispatchReportAction
  ),
  close_report_intake: handler(
    'close_report_intake',
    (runtime) => runtime.reports,
    dispatchReportAction
  ),
  complete_setup_verification: handler(
    'complete_setup_verification',
    (runtime) => runtime.setupRuntime,
    dispatchSetupAction
  ),
  upsert_report_instructions: handler(
    'upsert_report_instructions',
    (runtime) => runtime.setupRuntime,
    dispatchSetupAction
  ),
} satisfies Record<QueuedCommand['kind'], QueuedHandler>;

export function prepareQueuedAction(
  input: QueuedDispatchInput
): () => Promise<QueuedActionOutcome> {
  return queuedActionHandlers[input.action.command.kind](input);
}
async function dispatchCaseAction(
  actions: QueuedRequestRuntime['cases'],
  context: ActionContext,
  command: CaseCommand
): Promise<QueuedActionOutcome> {
  const outcome = requireCaseOutcome(await actions.execute(context, command));
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
      return { ...target, action_type: outcome.kind, succeeded: outcome.succeeded };
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
