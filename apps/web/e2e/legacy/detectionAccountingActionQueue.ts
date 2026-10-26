// Explicit legacy test-build boundary. Never imported by the release build.
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import type { ActionContext } from '@drasil/application';
import { type DetectionAccountingWebAction } from '../../lib/detectionAccountingActionQueue';
export * from '../../lib/detectionAccountingActionQueue';

export async function queueDetectionAccountingActionRequest(input: {
  readonly action: DetectionAccountingWebAction;
  readonly context: ActionContext;
  readonly detectionEventId: string;
  readonly reason?: string | null;
  readonly targetUserId: string;
}): Promise<ModerationActionRequestReceipt> {
  return {
    id: `fixture-detection-accounting-${input.action}-${input.detectionEventId}`,
    status: 'queued',
  };
}
