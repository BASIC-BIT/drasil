import { injectable, inject } from 'inversify';
import { PrismaClient } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import type { MessageContext, MessageContextCreate } from './types';

export const MESSAGE_CONTEXT_RETENTION_DAYS = 30;
export const MESSAGE_CONTEXT_USER_LIMIT = 20;
export const MESSAGE_CONTEXT_SERVER_LIMIT = 50_000;
export const MESSAGE_CONTEXT_PREVIEW_MAX_LENGTH = 500;

export interface IMessageContextRepository {
  recordMessage(data: MessageContextCreate): Promise<void>;
  findRecentByServerAndUser(
    serverId: string,
    userId: string,
    limit?: number
  ): Promise<MessageContext[]>;
  pruneExpired(now?: Date): Promise<number>;
}

@injectable()
export class MessageContextRepository implements IMessageContextRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }

    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }

  async recordMessage(data: MessageContextCreate): Promise<void> {
    try {
      const contentPreview = data.contentPreview.slice(0, MESSAGE_CONTEXT_PREVIEW_MAX_LENGTH);
      const contentFeaturesJson = JSON.stringify(data.contentFeatures ?? {});
      const observedAt = data.observedAt ?? new Date();

      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          INSERT INTO public.message_contexts (
            server_id,
            user_id,
            message_id,
            channel_id,
            content_preview,
            content_features,
            created_at,
            observed_at,
            expires_at
          ) VALUES (
            ${data.serverId},
            ${data.userId},
            ${data.messageId},
            ${data.channelId ?? null},
            ${contentPreview},
            CAST(${contentFeaturesJson} AS jsonb),
            ${data.createdAt},
            ${observedAt},
            ${data.expiresAt}
          )
          ON CONFLICT (server_id, message_id) DO UPDATE SET
            user_id = EXCLUDED.user_id,
            channel_id = EXCLUDED.channel_id,
            content_preview = EXCLUDED.content_preview,
            content_features = EXCLUDED.content_features,
            created_at = EXCLUDED.created_at,
            observed_at = EXCLUDED.observed_at,
            expires_at = EXCLUDED.expires_at
        `;

        await tx.$executeRaw`
          DELETE FROM public.message_contexts
          WHERE id IN (
            SELECT id FROM (
              SELECT
                id,
                row_number() OVER (
                  PARTITION BY server_id, user_id
                  ORDER BY created_at DESC, observed_at DESC
                ) AS row_number
              FROM public.message_contexts
              WHERE server_id = ${data.serverId}
                AND user_id = ${data.userId}
            ) ranked
            WHERE ranked.row_number > ${MESSAGE_CONTEXT_USER_LIMIT}
          )
        `;

        await tx.$executeRaw`
          DELETE FROM public.message_contexts
          WHERE id IN (
            SELECT id FROM (
              SELECT
                id,
                row_number() OVER (ORDER BY created_at DESC, observed_at DESC) AS row_number
              FROM public.message_contexts
              WHERE server_id = ${data.serverId}
            ) ranked
            WHERE ranked.row_number > ${MESSAGE_CONTEXT_SERVER_LIMIT}
          )
        `;
      });
    } catch (error) {
      this.handleError(error, 'recordMessage');
    }
  }

  async findRecentByServerAndUser(
    serverId: string,
    userId: string,
    limit = MESSAGE_CONTEXT_USER_LIMIT
  ): Promise<MessageContext[]> {
    try {
      const rows = await this.prisma.$queryRaw<MessageContext[]>`
        SELECT
          id,
          server_id,
          user_id,
          message_id,
          channel_id,
          content_preview,
          COALESCE(content_features, '{}'::jsonb) AS content_features,
          created_at,
          observed_at,
          expires_at
        FROM public.message_contexts
        WHERE server_id = ${serverId}
          AND user_id = ${userId}
          AND expires_at > now()
        ORDER BY created_at DESC, observed_at DESC
        LIMIT ${Math.max(1, Math.min(limit, MESSAGE_CONTEXT_USER_LIMIT))}
      `;

      return rows.reverse();
    } catch (error) {
      this.handleError(error, 'findRecentByServerAndUser');
    }
  }

  async pruneExpired(now = new Date()): Promise<number> {
    try {
      const result = await this.prisma.$executeRaw`
        DELETE FROM public.message_contexts
        WHERE expires_at <= ${now}
      `;
      return Number(result);
    } catch (error) {
      this.handleError(error, 'pruneExpired');
    }
  }
}
