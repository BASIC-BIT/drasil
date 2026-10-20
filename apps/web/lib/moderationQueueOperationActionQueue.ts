import { randomUUID } from 'node:crypto';
import {
  encodeQueuedAction,
  queuedOperationCommandSchema,
  type QueuedOperationCommand,
} from '@drasil/application';
import { isWebE2eFixtureMode } from './e2eFixtures';
import {
  queueModerationActionRequest,
  type ModerationActionRequestQueueStatus,
} from './moderationActionRequestQueue';
export type ModerationQueueOperationAction = QueuedOperationCommand['kind'];
export interface QueueModerationQueueOperationInput {
  readonly actorId: string;
  readonly guildId: string;
  readonly command: QueuedOperationCommand;
}
export async function queueModerationQueueOperation(
  input: QueueModerationQueueOperationInput
): Promise<ModerationActionRequestQueueStatus> {
  const command = queuedOperationCommandSchema.parse(input.command);
  if (isWebE2eFixtureMode()) return 'queued';
  const context = {
    guildId: input.guildId,
    requestId: randomUUID(),
    source: 'web',
    actor: { kind: 'user' as const, userId: input.actorId },
  };
  return queueModerationActionRequest(encodeQueuedAction(context, command));
}
