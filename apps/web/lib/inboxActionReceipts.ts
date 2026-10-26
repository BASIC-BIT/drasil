import type { WorkspaceConfirmedActionId } from './workspaceActionTypes';
import { isStaleInboxActionFailure } from './inboxActionState';
import type { ModerationInboxAction, ModerationInboxItem } from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import type { ModerationActionRequestActionType } from './moderationActionRequestQueue';
import type { MessageCleanupJobSummary } from '@drasil/contracts';

const requestTypeByAction: Partial<
  Record<WorkspaceConfirmedActionId, readonly ModerationActionRequestActionType[]>
> = {
  preview_case_message_deletion: ['preview_case_message_deletion'],
  execute_case_message_deletion: ['execute_case_message_deletion'],
  ban_case_user_with_message_cleanup: ['ban_case_user_with_message_cleanup'],
  ban_by_id: ['ban_case_user_by_id'],
  challenge_user: ['request_captcha_challenge'],
  retry_captcha: ['retry_captcha_challenge'],
  bypass_captcha: ['bypass_captcha_challenge'],
  ban_user: ['ban_case_user', 'ban_observed_detection'],
  close_no_action: ['close_case_no_action'],
  create_thread: ['repair_active_case'],
  dismiss_no_action: ['dismiss_observed_detection'],
  kick_user: ['kick_case_user', 'kick_observed_detection'],
  mark_false_positive: ['mark_observed_detection_false_positive'],
  open_case: ['open_case_from_observed_detection'],
  refresh_notification: ['refresh_case_notification'],
  reopen_case: ['reopen_case'],
  repair_thread: ['repair_active_case'],
  sync_existing_ban: ['sync_existing_ban'],
  verify_user: ['verify_case_user'],
  quarantine_compromised_account: ['preview_account_quarantine', 'quarantine_compromised_account'],
};

export interface AccountQuarantineActionRequests {
  readonly execute: ModerationActionRequestSummary | null;
  readonly preview: ModerationActionRequestSummary | null;
}

export function findAccountQuarantineActionRequests(
  requests: readonly ModerationActionRequestSummary[],
  verificationEventId: string
): AccountQuarantineActionRequests {
  const matchesCase = (request: ModerationActionRequestSummary) =>
    request.verificationEventId === verificationEventId;
  return {
    execute:
      requests.find(
        (request) => request.actionType === 'quarantine_compromised_account' && matchesCase(request)
      ) ?? null,
    preview:
      requests.find(
        (request) => request.actionType === 'preview_account_quarantine' && matchesCase(request)
      ) ?? null,
  };
}

function requestMatchesItem(
  request: ModerationActionRequestSummary,
  item: ModerationInboxItem
): boolean {
  switch (item.kind) {
    case 'case':
      return request.verificationEventId === item.sourceId;
    case 'observed_alert':
      return request.reportIntakeId === null && request.detectionEventId === item.sourceId;
    case 'submitted_report':
      return request.reportIntakeId === item.sourceId;
    case 'pending_screening':
    case 'report_attention':
    case 'support_attention':
      return false;
  }
}

export function findInboxActionRequest(
  requests: readonly ModerationActionRequestSummary[],
  item: ModerationInboxItem,
  action: ModerationInboxAction
): ModerationActionRequestSummary | null {
  const actionTypes = requestTypeByAction[action];
  if (!actionTypes) {
    return null;
  }

  return (
    requests.find(
      (request) =>
        actionTypes.includes(request.actionType) &&
        (!request.requestedAction || request.requestedAction === action) &&
        requestMatchesItem(request, item)
    ) ?? null
  );
}

export function findMessageCleanupActionRequest(
  requests: readonly ModerationActionRequestSummary[],
  job: Pick<MessageCleanupJobSummary, 'id' | 'mode'> | null
): ModerationActionRequestSummary | null {
  if (!job) {
    return null;
  }

  const actionType =
    job.mode === 'ban_with_cleanup'
      ? 'ban_case_user_with_message_cleanup'
      : 'execute_case_message_deletion';
  return (
    requests.find(
      (request) => request.actionType === actionType && request.messageDeletionJobId === job.id
    ) ?? null
  );
}

export function hasActiveInboxActionRequests(
  requests: readonly ModerationActionRequestSummary[]
): boolean {
  return requests.some((request) => request.status === 'queued' || request.status === 'processing');
}

export function reconcileLocalInboxActionRequestIds(
  localRequestIds: ReadonlySet<string>,
  serverRequests: readonly ModerationActionRequestSummary[],
  ignoredFailedSnapshots: ReadonlyMap<string, string | null> = new Map()
): ReadonlySet<string> {
  const next = new Set(localRequestIds);
  for (const request of serverRequests) {
    if (isStaleInboxActionFailure(request, ignoredFailedSnapshots.get(request.id) ?? null))
      continue;
    if (request.status === 'completed' || request.status === 'failed') {
      next.delete(request.id);
    }
  }
  return next.size === localRequestIds.size ? localRequestIds : next;
}

export function blocksBanResubmission(request: ModerationActionRequestSummary | null): boolean {
  return Boolean(
    request &&
    (request.status === 'queued' ||
      request.status === 'processing' ||
      request.observedBanResult?.status === 'banned' ||
      request.observedBanResult?.status === 'banned_updates_pending' ||
      request.observedBanResult?.status === 'ban_outcome_unknown')
  );
}

export interface WorkspaceRequestTarget {
  readonly kind: 'case' | 'submitted_report' | 'observed_alert' | 'attention';
  readonly recordId: string;
  readonly targetUserId: string | null;
}
export function matchesWorkspaceActionRequest(
  request: ModerationActionRequestSummary,
  target: WorkspaceRequestTarget,
  action: WorkspaceConfirmedActionId
): boolean {
  const types = requestTypeByAction[action];
  if (
    !types?.includes(request.actionType) ||
    (request.requestedAction && request.requestedAction !== action) ||
    request.targetUserId !== target.targetUserId
  )
    return false;
  switch (target.kind) {
    case 'case':
      return request.verificationEventId === target.recordId;
    case 'submitted_report':
      return request.reportIntakeId === target.recordId;
    case 'observed_alert':
      return request.reportIntakeId === null && request.detectionEventId === target.recordId;
    case 'attention':
      return false;
  }
}
