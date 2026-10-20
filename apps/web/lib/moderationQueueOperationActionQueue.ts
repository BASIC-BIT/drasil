import {
  type ActionContext,
  queuedOperationCommandSchema,
  type QueuedOperationCommand,
} from '@drasil/application';
import { submitQueuedAction } from './application/queuedSubmission';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type { ModerationActionRequestReceipt } from './moderationActionRequestQueue';
export type ModerationQueueOperationAction = QueuedOperationCommand['kind'];
export interface QueueModerationQueueOperationInput {
  readonly context: ActionContext;
  readonly command: QueuedOperationCommand;
}
export async function queueModerationQueueOperation(
  input: QueueModerationQueueOperationInput
): Promise<ModerationActionRequestReceipt> {
  const command = queuedOperationCommandSchema.parse(input.command);
  if (isWebE2eFixtureMode()) return { id: `fixture-operation-${command.kind}`, status: 'queued' };
  return submitQueuedAction({ context: input.context, command });
}
