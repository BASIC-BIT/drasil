import type {
  QueueAttentionItemRecord,
  QueueAttentionRepository,
  QueueMessageDeleter,
} from '@drasil/application';
import { deleteBotMessage } from '../../discordApi';
import { getPostgresPool } from '../../setupDataAdapter';

export class PostgresQueueAttentionRepository implements QueueAttentionRepository {
  public async findById(id: string): Promise<QueueAttentionItemRecord | null> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `select id, server_id, item_type, queue_channel_id, queue_message_id
       from moderation_queue_items where id = $1 limit 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }
  public async deleteById(id: string): Promise<QueueAttentionItemRecord | null> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `delete from moderation_queue_items where id = $1
       returning id, server_id, item_type, queue_channel_id, queue_message_id`,
      [id]
    );
    return result.rows[0] ?? null;
  }
}
export function createWebAttentionMessageDeleter(): QueueMessageDeleter {
  return {
    async deleteQueueMessage(item): Promise<void> {
      if (!item.queue_channel_id || !item.queue_message_id) return;
      await deleteBotMessage(item.queue_channel_id, item.queue_message_id).catch((error) => {
        console.warn(`Failed to delete acknowledged queue message ${item.id}:`, error);
      });
    },
  };
}
