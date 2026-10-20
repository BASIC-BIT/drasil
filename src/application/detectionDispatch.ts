import type {
  ActionContext,
  QueuedDetectionCommand,
  DetectionActions,
  ObservedBanResult,
} from '@drasil/application';
import { requireDetectionOutcome } from './adapters/detections';
type DetectionReceipt = { readonly target_user_id: string; readonly detection_event_id: string };
export type QueuedDetectionOutcome = DetectionReceipt &
  (
    | {
        readonly action_type:
          | 'dismiss_observed_detection'
          | 'mark_observed_detection_false_positive';
        readonly dismissed: boolean;
      }
    | {
        readonly action_type: 'undo_observed_detection_action';
        readonly undone_action: 'dismiss' | 'false_positive' | null;
      }
    | { readonly action_type: 'kick_observed_detection'; readonly kicked: boolean }
    | {
        readonly action_type: 'ban_observed_detection';
        readonly observed_ban_result: ObservedBanResult;
        readonly report_intake_id: string | null;
        readonly ban_by_id?: boolean;
      }
    | { readonly action_type: 'ignore_detection_accounting'; readonly ignored: boolean }
    | { readonly action_type: 'restore_detection_accounting'; readonly restored: boolean }
  );
export async function dispatchDetectionAction(
  actions: DetectionActions,
  context: ActionContext,
  command: QueuedDetectionCommand
): Promise<QueuedDetectionOutcome> {
  const outcome = requireDetectionOutcome(await actions.execute(context, command));
  const base = {
    target_user_id: command.targetUserId,
    detection_event_id: command.detectionEventId,
  };
  switch (outcome.kind) {
    case 'ban_observed_detection':
      if (command.kind !== 'ban_observed_detection') throw new Error('Detection outcome mismatch.');
      return {
        ...base,
        action_type: outcome.kind,
        observed_ban_result: outcome.result,
        report_intake_id: command.subject.kind === 'report' ? command.subject.reportId : null,
        ...(outcome.banById !== undefined ? { ban_by_id: outcome.banById } : {}),
      };
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
      return { ...base, action_type: outcome.kind, dismissed: outcome.succeeded };
    case 'undo_observed_detection_action':
      return { ...base, action_type: outcome.kind, undone_action: outcome.undoneAction };
    case 'kick_observed_detection':
      return { ...base, action_type: outcome.kind, kicked: outcome.succeeded };
    case 'ignore_detection_accounting':
      return { ...base, action_type: outcome.kind, ignored: outcome.succeeded };
    case 'restore_detection_accounting':
      return { ...base, action_type: outcome.kind, restored: outcome.succeeded };
    default:
      throw new Error('Report review executes directly.');
  }
}
