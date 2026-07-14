import type { ModerationInboxAction, ModerationInboxItem } from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import type { ModerationActionRequestActionType } from './moderationActionRequestQueue';

const requestTypeByAction: Partial<
  Record<ModerationInboxAction, readonly ModerationActionRequestActionType[]>
> = {
  ban_by_id: ['ban_case_user_by_id'],
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
};

const inboxRequestTypes = new Set(
  Object.values(requestTypeByAction).flatMap((actionTypes) => actionTypes ?? [])
);

function requestMatchesItem(
  request: ModerationActionRequestSummary,
  item: ModerationInboxItem
): boolean {
  switch (item.kind) {
    case 'case':
      return request.verificationEventId === item.sourceId;
    case 'observed_alert':
      return request.detectionEventId === item.sourceId;
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

export function hasActiveInboxActionRequests(
  requests: readonly ModerationActionRequestSummary[]
): boolean {
  return requests.some(
    (request) =>
      inboxRequestTypes.has(request.actionType) &&
      (request.status === 'queued' || request.status === 'processing')
  );
}
