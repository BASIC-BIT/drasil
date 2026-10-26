import type { ActionResult, AttentionOutcome, QueueActionActor } from '@drasil/application';
import { createWebActionContext } from './application/context';
import { createWebApplication, type WebApplication } from './application/createWebApplication';

export type { QueueAttentionAcknowledgeStatus } from '@drasil/application';
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
export interface QueueAttentionActionAdapter {
  acknowledgeAttentionItem(input: AttentionInput): Promise<AttentionOutcome>;
  acknowledgeAttentionItems(input: AttentionBatchInput): Promise<readonly AttentionOutcome[]>;
}
function unwrap(result: ActionResult<AttentionOutcome>): AttentionOutcome {
  if (result.kind === 'denied')
    throw new Error('You need moderation permissions to acknowledge queue reminders.');
  return result.outcome;
}
export class PostgresQueueAttentionActionAdapter implements QueueAttentionActionAdapter {
  public constructor(
    private readonly application: Pick<WebApplication, 'attention'> = createWebApplication()
  ) {}
  public async acknowledgeAttentionItem(input: AttentionInput): Promise<AttentionOutcome> {
    return unwrap(
      await this.application.attention.acknowledge(
        createWebActionContext({ guildId: input.guildId, userId: input.actor.id }),
        { itemId: input.queueItemId }
      )
    );
  }
  public async acknowledgeAttentionItems(
    input: AttentionBatchInput
  ): Promise<readonly AttentionOutcome[]> {
    const results = await this.application.attention.acknowledgeBatch(
      createWebActionContext({ guildId: input.guildId, userId: input.actor.id }),
      { itemIds: input.queueItemIds }
    );
    return results.map(unwrap);
  }
}
export function createQueueAttentionActionAdapter(): QueueAttentionActionAdapter {
  return new PostgresQueueAttentionActionAdapter();
}
