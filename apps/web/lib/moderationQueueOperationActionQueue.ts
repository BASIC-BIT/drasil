import {
  type ActionContext,
  queuedOperationCommandSchema,
  type QueuedOperationCommand,
} from '@drasil/application';
import { submitQueuedAction } from './application/queuedSubmission';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type { ModerationActionRequestReceipt } from './moderationActionRequestQueue';
// Native website integrity audits retain their existing read path.
type NativeQueuedOperationCommand = Exclude<QueuedOperationCommand, { kind: 'audit_integrity' }>;
export type ModerationQueueOperationAction = NativeQueuedOperationCommand['kind'];
export interface QueueModerationQueueOperationInput {
  readonly context: ActionContext;
  readonly command: NativeQueuedOperationCommand;
}
export async function queueModerationQueueOperation(
  input: QueueModerationQueueOperationInput
): Promise<ModerationActionRequestReceipt> {
  const command = queuedOperationCommandSchema.parse(input.command);
  if (isWebE2eFixtureMode()) return { id: `fixture-operation-${command.kind}`, status: 'queued' };
  return submitQueuedAction({ context: input.context, command });
}
