import {
  dispatchMessageCleanupAction,
  type QueuedMessageCleanupOutcome,
} from './messageCleanupDispatch';
import { requireCaptchaOutcome } from './adapters/captcha';
import {
  isQueuedCaptchaCommand,
  isQueuedMessageCleanupCommand,
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
export async function dispatchQueuedAction(
  application: BotApplication,
  action: DecodedQueuedAction
): Promise<QueuedActionOutcome> {
  const { command, context } = action;
  if (isQueuedCaptchaCommand(command))
    return requireCaptchaOutcome(await application.captcha.execute(context, command));
  if (isQueuedMessageCleanupCommand(command))
    return dispatchMessageCleanupAction(application.messageCleanup, context, command);
  switch (command.kind) {
    case 'preview_account_quarantine':
    case 'quarantine_compromised_account':
      return dispatchQuarantineAction(application.quarantine, context, command);
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
    case 'undo_observed_detection_action':
    case 'kick_observed_detection':
    case 'ban_observed_detection':
    case 'ignore_detection_accounting':
    case 'restore_detection_accounting':
      return dispatchDetectionAction(application.detections, context, command);
  }
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
