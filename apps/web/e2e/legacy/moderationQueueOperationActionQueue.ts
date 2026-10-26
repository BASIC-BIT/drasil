// Explicit legacy test-build boundary. Never imported by the release build.
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import { queuedOperationCommandSchema } from '@drasil/application';
import { type QueueModerationQueueOperationInput } from '../../lib/moderationQueueOperationActionQueue';
export * from '../../lib/moderationQueueOperationActionQueue';

export async function queueModerationQueueOperation(
  input: QueueModerationQueueOperationInput
): Promise<ModerationActionRequestReceipt> {
  const command = queuedOperationCommandSchema.parse(input.command);
  return { id: `fixture-operation-${command.kind}`, status: 'queued' };
}
