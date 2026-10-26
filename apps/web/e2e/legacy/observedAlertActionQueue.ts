// Explicit legacy test-build boundary. Never imported by the release build.
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import type { ActionContext } from '@drasil/application';
import { type ObservedAlertWebAction } from '../../lib/observedAlertActionQueue';
export * from '../../lib/observedAlertActionQueue';

export async function queueObservedAlertActionRequest(input: {
  readonly action: ObservedAlertWebAction;
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly reason?: string | null;
  readonly reportId?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  return {
    id: `fixture-observed-action-${input.action}-${input.detectionEventId}`,
    status: input.action === 'dismiss_no_action' ? 'completed' : 'queued',
  };
}

export async function queueObservedAlertUndoActionRequest(input: {
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  return { id: `fixture-observed-undo-${input.detectionEventId}`, status: 'queued' };
}
