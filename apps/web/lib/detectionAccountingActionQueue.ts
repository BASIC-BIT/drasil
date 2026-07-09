import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestActionType,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export type DetectionAccountingWebAction = 'ignore_detection' | 'restore_detection';

const detectionAccountingRequestTypes: Record<
  DetectionAccountingWebAction,
  ModerationActionRequestActionType
> = {
  ignore_detection: 'ignore_detection_accounting',
  restore_detection: 'restore_detection_accounting',
};

export function isDetectionAccountingWebAction(
  action: string
): action is DetectionAccountingWebAction {
  return action in detectionAccountingRequestTypes;
}

export async function queueDetectionAccountingActionRequest(input: {
  readonly action: DetectionAccountingWebAction;
  readonly actorId: string;
  readonly actorSurface: string;
  readonly detectionEventId: string;
  readonly guildId: string;
  readonly reason?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestQueueStatus> {
  if (isWebE2eFixtureMode()) {
    return 'queued';
  }

  return queueModerationActionRequest({
    actionType: detectionAccountingRequestTypes[input.action],
    actorId: input.actorId,
    actorSurface: input.actorSurface,
    detectionEventId: input.detectionEventId,
    idempotencyKey: `web:detection-accounting:${input.action}:${input.guildId}:${input.detectionEventId}`,
    metadata: {
      reason: input.reason ?? null,
      requested_surface: input.actorSurface,
      web_action: input.action,
    },
    serverId: input.guildId,
    targetUserId: input.targetUserId,
  });
}
