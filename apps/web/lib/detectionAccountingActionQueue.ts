import { encodeQueuedAction } from '@drasil/application';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';

export type DetectionAccountingWebAction = 'ignore_detection' | 'restore_detection';

const detectionAccountingRequestTypes = {
  ignore_detection: 'ignore_detection_accounting',
  restore_detection: 'restore_detection_accounting',
} as const;

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

  return queueModerationActionRequest(
    encodeQueuedAction(
      {
        guildId: input.guildId,
        requestId: input.detectionEventId,
        source: input.actorSurface,
        actor: { kind: 'user', userId: input.actorId },
      },
      {
        kind: detectionAccountingRequestTypes[input.action],
        targetUserId: input.targetUserId,
        detectionEventId: input.detectionEventId,
        reason: input.reason ?? null,
      }
    )
  );
}
