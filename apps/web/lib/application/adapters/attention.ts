import { acknowledgeIdentityReviewMetadata, isIdentityReviewItem } from '@drasil/application';
import { createWebDelegationDatabase } from '../../mcp/adapters/database';
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
      `select id, server_id, item_type, queue_channel_id, queue_message_id, report_intake_id, metadata, attention_cleanup_pending
       from moderation_queue_items where id = $1 limit 1`,
      [id]
    );
    return result.rows[0] ?? null;
  }
  public async acknowledgeIdentityReview(input: {
    itemId: string;
    guildId: string;
    actorId: string;
    acknowledgedAt: Date;
  }): Promise<'acknowledged' | 'already_handled'> {
    return createWebDelegationDatabase().transaction(async (client) => {
      const found = await client.query<QueueAttentionItemRecord & Record<string, unknown>>(
        `select id, server_id, item_type, queue_channel_id, queue_message_id, report_intake_id, metadata, attention_cleanup_pending from moderation_queue_items where id=$1::uuid`,
        [input.itemId]
      );
      const item = found.rows[0];
      if (
        !item?.report_intake_id ||
        item.server_id !== input.guildId ||
        !isIdentityReviewItem(item)
      )
        return 'already_handled';
      const result = await client.query<{ id: string; metadata: unknown }>(
        `select id, metadata from report_intakes where id=$1::uuid and server_id=$2
         and status='needs_admin_confirmation' and closed_at is null and confirmed_target_user_id is null for update`,
        [item.report_intake_id, input.guildId]
      );
      const intake = result.rows[0];
      const metadata =
        intake &&
        acknowledgeIdentityReviewMetadata(intake.metadata, input.actorId, input.acknowledgedAt);
      if (!metadata) return 'already_handled';
      const updated = await client.query<{ id: string }>(
        `update moderation_queue_items set updated_at=$4 where id=$1::uuid and server_id=$2 and report_intake_id=$3::uuid returning id`,
        [input.itemId, input.guildId, intake.id, input.acknowledgedAt]
      );
      if (!updated.rows[0]) return 'already_handled';
      await client.query(
        `update report_intakes set metadata=$2::jsonb, updated_at=$3 where id=$1::uuid`,
        [intake.id, JSON.stringify(metadata), input.acknowledgedAt]
      );
      return 'acknowledged';
    });
  }
  public async reserveOrdinaryAcknowledgement(
    itemId: string,
    guildId: string
  ): Promise<QueueAttentionItemRecord | null> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `update moderation_queue_items set attention_cleanup_pending=true, updated_at=now(),
         metadata=case when attention_cleanup_pending then metadata else
           jsonb_set(coalesce(metadata,'{}'::jsonb),'{attention_cleanup}',jsonb_build_object(
             'source_thread_id',source_thread_id,'verification_event_id',verification_event_id,
             'detection_event_id',detection_event_id)) end,
         source_thread_id=null, verification_event_id=null, detection_event_id=null
       where id=$1::uuid and server_id=$2
         and item_type in ('support_thread_attention','report_thread_attention','quarantine_breach_attention')
         and not (item_type='report_thread_attention' and report_intake_id is not null
           and coalesce(jsonb_typeof(metadata->'identity_review')='object',false))
       returning *`,
      [itemId, guildId]
    );
    return result.rows[0] ?? this.findById(itemId);
  }
  public async completeOrdinaryAcknowledgement(item: QueueAttentionItemRecord): Promise<boolean> {
    const result = await getPostgresPool().query(
      `delete from moderation_queue_items where id=$1::uuid and server_id=$2 and attention_cleanup_pending
         and queue_channel_id is not distinct from $3 and queue_message_id is not distinct from $4 returning id`,
      [item.id, item.server_id, item.queue_channel_id, item.queue_message_id]
    );
    return result.rows.length > 0;
  }
}
export function createWebAttentionMessageDeleter(): QueueMessageDeleter {
  return {
    async deleteQueueMessage(item): Promise<void> {
      if (!item.queue_channel_id || !item.queue_message_id) return;
      // A missing message is successful cleanup; transport/permission failures retain the reservation.
      await deleteBotMessage(item.queue_channel_id, item.queue_message_id);
    },
  };
}
