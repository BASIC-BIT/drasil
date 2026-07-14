import type { ModerationInboxAction } from '@drasil/contracts';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  queueModerationActionRequestWithReceipt,
  type ModerationActionRequestActionType,
  type ModerationActionRequestQueueStatus,
  type ModerationActionRequestReceipt,
} from './moderationActionRequestQueue';

export type ObservedAlertWebAction = Extract<
  ModerationInboxAction,
  'open_case' | 'dismiss_no_action' | 'mark_false_positive' | 'kick_user' | 'ban_user'
>;

const observedAlertRequestTypes: Record<ObservedAlertWebAction, ModerationActionRequestActionType> =
  {
    dismiss_no_action: 'dismiss_observed_detection',
    ban_user: 'ban_observed_detection',
    kick_user: 'kick_observed_detection',
    mark_false_positive: 'mark_observed_detection_false_positive',
    open_case: 'open_case_from_observed_detection',
  };

export function isObservedAlertWebAction(
  action: ModerationInboxAction
): action is ObservedAlertWebAction {
  return action in observedAlertRequestTypes;
}

export async function queueObservedAlertActionRequest(input: {
  readonly action: ObservedAlertWebAction;
  readonly actorId: string;
  readonly actorSurface: string;
  readonly detectionEventId: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  if (isWebE2eFixtureMode()) {
    return {
      id: `fixture-observed-action-${input.action}-${input.detectionEventId}`,
      status: 'queued',
    };
  }

  return queueModerationActionRequestWithReceipt({
    actionType: observedAlertRequestTypes[input.action],
    actorId: input.actorId,
    actorSurface: input.actorSurface,
    detectionEventId: input.detectionEventId,
    idempotencyKey: `web:observed-action:${input.action}:${input.guildId}:${input.detectionEventId}`,
    metadata: {
      inbox_action: input.action,
      reason: input.reason ?? null,
      requested_surface: input.actorSurface,
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}

export async function queueObservedAlertUndoActionRequest(input: {
  readonly actorId: string;
  readonly actorSurface: string;
  readonly detectionEventId: string;
  readonly guildId: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: 'undo_observed_detection_action',
    actorId: input.actorId,
    actorSurface: input.actorSurface,
    detectionEventId: input.detectionEventId,
    idempotencyKey: `web:observed-action:undo:${input.guildId}:${input.detectionEventId}`,
    metadata: {
      inbox_action: 'undo_observed_action',
      requested_surface: input.actorSurface,
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}
