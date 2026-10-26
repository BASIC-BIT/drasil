// Explicit legacy test-build boundary. Never imported by the release build.
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import type { AttentionOutcome, QueueActionActor } from '@drasil/application';
import {
  type QueueAttentionActionAdapter,
  PostgresQueueAttentionActionAdapter,
} from '../../lib/queueAttentionActionAdapter';
export * from '../../lib/queueAttentionActionAdapter';

export class FixtureQueueAttentionActionAdapter implements QueueAttentionActionAdapter {
  public async acknowledgeAttentionItem(input: AttentionInput): Promise<AttentionOutcome> {
    return {
      actor: input.actor,
      itemId: input.queueItemId,
      status: input.queueItemId === 'queue-support-1' ? 'already_handled' : 'acknowledged',
    };
  }
  public async acknowledgeAttentionItems(
    input: AttentionBatchInput
  ): Promise<readonly AttentionOutcome[]> {
    return Promise.all(
      input.queueItemIds.map((queueItemId) =>
        this.acknowledgeAttentionItem({ ...input, queueItemId })
      )
    );
  }
}

export function createQueueAttentionActionAdapter(): QueueAttentionActionAdapter {
  return isWebE2eFixtureMode()
    ? new FixtureQueueAttentionActionAdapter()
    : new PostgresQueueAttentionActionAdapter();
}

interface AttentionInput {
  readonly guildId: string;
  readonly queueItemId: string;
  readonly actor: QueueActionActor;
}

interface AttentionBatchInput {
  readonly guildId: string;
  readonly queueItemIds: readonly string[];
  readonly actor: QueueActionActor;
}
