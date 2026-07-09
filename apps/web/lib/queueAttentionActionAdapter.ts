import {
  QueueAttentionService,
  type QueueActionActor,
  type QueueAttentionItemRecord,
  type QueueAttentionRepository,
  type AcknowledgeQueueAttentionResult,
} from '../../../src/services/QueueAttentionService';
import { deleteBotMessage } from './discordApi';
import { isWebE2eFixtureMode } from './e2eFixtures';
import { getPostgresPool } from './setupDataAdapter';

export interface QueueAttentionActionAdapter {
  acknowledgeAttentionItem(input: {
    guildId: string;
    queueItemId: string;
    actor: QueueActionActor;
  }): Promise<AcknowledgeQueueAttentionResult>;
}

class PostgresQueueAttentionRepository implements QueueAttentionRepository {
  public async findById(id: string): Promise<QueueAttentionItemRecord | null> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `select id, server_id, item_type, queue_channel_id, queue_message_id
       from moderation_queue_items
       where id = $1
       limit 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  public async deleteById(id: string): Promise<QueueAttentionItemRecord | null> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `delete from moderation_queue_items
       where id = $1
       returning id, server_id, item_type, queue_channel_id, queue_message_id`,
      [id]
    );
    return result.rows[0] ?? null;
  }
}

export class PostgresQueueAttentionActionAdapter implements QueueAttentionActionAdapter {
  public constructor(
    private readonly service = new QueueAttentionService(new PostgresQueueAttentionRepository(), {
      deleteQueueMessage: async (item) => {
        if (!item.queue_channel_id || !item.queue_message_id) {
          return;
        }

        await deleteBotMessage(item.queue_channel_id, item.queue_message_id).catch((error) => {
          console.warn(`Failed to delete acknowledged queue message ${item.id}:`, error);
        });
      },
    })
  ) {}

  public acknowledgeAttentionItem(input: {
    guildId: string;
    queueItemId: string;
    actor: QueueActionActor;
  }): Promise<AcknowledgeQueueAttentionResult> {
    return this.service.acknowledgeAttentionItem({
      actor: input.actor,
      itemId: input.queueItemId,
      serverId: input.guildId,
    });
  }
}

export class FixtureQueueAttentionActionAdapter implements QueueAttentionActionAdapter {
  public async acknowledgeAttentionItem(input: {
    guildId: string;
    queueItemId: string;
    actor: QueueActionActor;
  }): Promise<AcknowledgeQueueAttentionResult> {
    return {
      actor: input.actor,
      itemId: input.queueItemId,
      status: 'acknowledged',
    };
  }
}

export function createQueueAttentionActionAdapter(): QueueAttentionActionAdapter {
  if (isWebE2eFixtureMode()) {
    return new FixtureQueueAttentionActionAdapter();
  }

  return new PostgresQueueAttentionActionAdapter();
}
