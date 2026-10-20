import type {
  AuthorityFacts,
  AuthorityPort,
  QueueAttentionItemRecord,
  QueueAttentionRepository,
  QueueMessageDeleter,
} from '@drasil/application';
import {
  DiscordApiError,
  deleteBotMessage,
  fetchDiscordGuild,
  fetchDiscordGuildMember,
  fetchDiscordGuildRoles,
} from '../../discordApi';
import { computeGuildPermissions } from '../../discordPermissions';
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
export function createWebAuthority(): AuthorityPort {
  return {
    async loadFresh(guildId, userId): Promise<AuthorityFacts | null> {
      try {
        const [guild, member, roles] = await Promise.all([
          fetchDiscordGuild(guildId),
          fetchDiscordGuildMember(guildId, userId),
          fetchDiscordGuildRoles(guildId),
        ]);
        return {
          guildId: guild.id,
          userId,
          present: true,
          owner: guild.owner_id === userId,
          permissions: computeGuildPermissions({
            guildId,
            roles,
            memberRoleIds: member.roles,
          }).toString(),
          roleIds: member.roles,
        };
      } catch (error) {
        if (error instanceof DiscordApiError && error.status === 404) return null;
        throw error;
      }
    },
  };
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
