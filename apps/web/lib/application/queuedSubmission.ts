import {
  encodeQueuedAction,
  type ActionContext,
  type QueuedCommand,
  type QueuedSetupCommand,
} from '@drasil/application';
import {
  insertModerationActionRequestWithReceipt,
  insertSerializedSetupRequestWithReceipt,
  type ModerationActionRequestReceipt,
} from '../moderationActionRequestQueue';
import { getPostgresPool } from '../setupDataAdapter';

export interface SubmitQueuedActionInput {
  readonly context: ActionContext;
  readonly command: QueuedCommand;
}

export async function submitQueuedAction(
  input: SubmitQueuedActionInput
): Promise<ModerationActionRequestReceipt> {
  const encoded = encodeQueuedAction(input.context, input.command);
  return insertModerationActionRequestWithReceipt(getPostgresPool(), encoded);
}

export async function submitSerializedSetupAction(input: {
  readonly context: ActionContext;
  readonly command: Extract<QueuedSetupCommand, { kind: 'complete_setup_verification' }>;
}): Promise<ModerationActionRequestReceipt> {
  const encoded = encodeQueuedAction(input.context, input.command);
  return insertSerializedSetupRequestWithReceipt(getPostgresPool(), encoded);
}
