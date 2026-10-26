import type { ActionContext, QueuedDetectionCommand } from '@drasil/application';
import type { ModerationInboxAction } from '@drasil/contracts';
import { submitQueuedAction } from './application/queuedSubmission';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type {
  ModerationActionRequestActionType,
  ModerationActionRequestReceipt,
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
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly reason?: string | null;
  readonly reportId?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  if (isWebE2eFixtureMode()) {
    return {
      id: `fixture-observed-action-${input.action}-${input.detectionEventId}`,
      status: input.action === 'dismiss_no_action' ? 'completed' : 'queued',
    };
  }

  if (input.action !== 'open_case') {
    const target = { targetUserId: input.targetUserId, detectionEventId: input.detectionEventId };
    const command: QueuedDetectionCommand =
      input.action === 'ban_user'
        ? {
            kind: 'ban_observed_detection',
            ...target,
            reason: input.reason ?? null,
            subject: input.reportId
              ? { kind: 'report', reportId: input.reportId }
              : { kind: 'observed' },
          }
        : input.action === 'kick_user'
          ? { kind: 'kick_observed_detection', ...target, reason: input.reason ?? null }
          : {
              kind:
                input.action === 'dismiss_no_action'
                  ? 'dismiss_observed_detection'
                  : 'mark_observed_detection_false_positive',
              ...target,
            };
    return submitQueuedAction({ context: input.context, command });
  }
  return submitQueuedAction({
    context: input.context,
    command: {
      kind: 'open_case_from_observed_detection',
      targetUserId: input.targetUserId,
      detectionEventId: input.detectionEventId,
      reportId: null,
      origin: { kind: 'observed_alert', reason: input.reason ?? null },
    },
  });
}

export async function queueObservedAlertUndoActionRequest(input: {
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  if (isWebE2eFixtureMode()) {
    return { id: `fixture-observed-undo-${input.detectionEventId}`, status: 'queued' };
  }

  return submitQueuedAction({
    context: input.context,
    command: {
      kind: 'undo_observed_detection_action',
      targetUserId: input.targetUserId,
      detectionEventId: input.detectionEventId,
    },
  });
}
