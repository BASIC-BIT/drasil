import type { ActionContext } from '@drasil/application';
import { submitQueuedAction } from './application/queuedSubmission';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type { ModerationActionRequestReceipt } from './moderationActionRequestQueue';

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
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly reason?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  if (isWebE2eFixtureMode()) {
    return {
      id: `fixture-detection-accounting-${input.action}-${input.detectionEventId}`,
      status: 'queued',
    };
  }

  return submitQueuedAction({
    context: input.context,
    command: {
      kind: detectionAccountingRequestTypes[input.action],
      targetUserId: input.targetUserId,
      detectionEventId: input.detectionEventId,
      reason: input.reason ?? null,
    },
  });
}
