import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, moderation_queue_item_type } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import { ModerationQueueItem, ModerationQueueItemType, ModerationQueueItemUpsert } from './types';

export interface IModerationQueueRepository {
  findById(id: string): Promise<ModerationQueueItem | null>;
  findByCase(verificationEventId: string): Promise<ModerationQueueItem | null>;
  findByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem | null>;
  findAttentionByThread(
    itemType: ModerationQueueItemType,
    sourceThreadId: string
  ): Promise<ModerationQueueItem | null>;
  listByServer(serverId: string): Promise<ModerationQueueItem[]>;
  listByServerAndTypes(
    serverId: string,
    itemTypes: ModerationQueueItemType[]
  ): Promise<ModerationQueueItem[]>;
  upsert(data: ModerationQueueItemUpsert): Promise<ModerationQueueItem>;
  updateDiscordMessage(
    id: string,
    queueChannelId: string | null,
    queueMessageId: string | null
  ): Promise<ModerationQueueItem | null>;
  deleteById(id: string): Promise<ModerationQueueItem | null>;
  deleteByCase(verificationEventId: string): Promise<ModerationQueueItem[]>;
  deleteByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem[]>;
  deleteByReportIntake(reportIntakeId: string): Promise<ModerationQueueItem[]>;
}

@injectable()
export class ModerationQueueRepository implements IModerationQueueRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    }
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }
    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }

  async findById(id: string): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findUnique({ where: { id } });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueItemById');
    }
  }

  async findByCase(verificationEventId: string): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findFirst({
        where: {
          item_type: ModerationQueueItemType.CASE_MIRROR as moderation_queue_item_type,
          verification_event_id: verificationEventId,
        },
      });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueItemByCase');
    }
  }

  async findByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findFirst({
        where: {
          item_type: ModerationQueueItemType.OBSERVED_ALERT_MIRROR as moderation_queue_item_type,
          detection_event_id: detectionEventId,
        },
      });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueItemByObservedAlert');
    }
  }

  async findAttentionByThread(
    itemType: ModerationQueueItemType,
    sourceThreadId: string
  ): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findFirst({
        where: {
          item_type: itemType as moderation_queue_item_type,
          source_thread_id: sourceThreadId,
        },
      });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueAttentionByThread');
    }
  }

  async listByServer(serverId: string): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: { server_id: serverId },
        orderBy: [{ item_type: 'asc' }, { created_at: 'asc' }],
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByServer');
    }
  }

  async listByServerAndTypes(
    serverId: string,
    itemTypes: ModerationQueueItemType[]
  ): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: {
          server_id: serverId,
          item_type: { in: itemTypes as moderation_queue_item_type[] },
        },
        orderBy: { created_at: 'asc' },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByServerAndTypes');
    }
  }

  async upsert(data: ModerationQueueItemUpsert): Promise<ModerationQueueItem> {
    try {
      const existing = await this.findExistingItem(data);
      const writeData = this.toPrismaWriteData(data);
      if (existing) {
        const updated = await this.prisma.moderation_queue_items.update({
          where: { id: existing.id },
          data: {
            ...writeData,
            updated_at: new Date(),
          },
        });
        return updated as ModerationQueueItem;
      }

      const created = await this.prisma.moderation_queue_items.create({ data: writeData });
      return created as ModerationQueueItem;
    } catch (error) {
      this.handleError(error, 'upsertModerationQueueItem');
    }
  }

  async updateDiscordMessage(
    id: string,
    queueChannelId: string | null,
    queueMessageId: string | null
  ): Promise<ModerationQueueItem | null> {
    try {
      const updated = await this.prisma.moderation_queue_items.update({
        where: { id },
        data: {
          queue_channel_id: queueChannelId,
          queue_message_id: queueMessageId,
          updated_at: new Date(),
        },
      });
      return updated as ModerationQueueItem;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'updateModerationQueueDiscordMessage');
    }
  }

  async deleteById(id: string): Promise<ModerationQueueItem | null> {
    try {
      const deleted = await this.prisma.moderation_queue_items.delete({ where: { id } });
      return deleted as ModerationQueueItem;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'deleteModerationQueueItemById');
    }
  }

  async deleteByCase(verificationEventId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMany({ verification_event_id: verificationEventId });
  }

  async deleteByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMany({
      item_type: ModerationQueueItemType.OBSERVED_ALERT_MIRROR as moderation_queue_item_type,
      detection_event_id: detectionEventId,
    });
  }

  async deleteByReportIntake(reportIntakeId: string): Promise<ModerationQueueItem[]> {
    return this.deleteMany({ report_intake_id: reportIntakeId });
  }

  private async deleteMany(
    where: Prisma.moderation_queue_itemsWhereInput
  ): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({ where });
      if (items.length === 0) {
        return [];
      }

      await this.prisma.moderation_queue_items.deleteMany({
        where: { id: { in: items.map((item) => item.id) } },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'deleteModerationQueueItems');
    }
  }

  private async findExistingItem(
    data: ModerationQueueItemUpsert
  ): Promise<ModerationQueueItem | null> {
    if (data.itemType === ModerationQueueItemType.CASE_MIRROR && data.verificationEventId) {
      return this.findByCase(data.verificationEventId);
    }
    if (data.itemType === ModerationQueueItemType.OBSERVED_ALERT_MIRROR && data.detectionEventId) {
      return this.findByObservedAlert(data.detectionEventId);
    }
    if (
      (data.itemType === ModerationQueueItemType.SUPPORT_THREAD_ATTENTION ||
        data.itemType === ModerationQueueItemType.REPORT_THREAD_ATTENTION) &&
      data.sourceThreadId
    ) {
      return this.findAttentionByThread(data.itemType, data.sourceThreadId);
    }

    return null;
  }

  private toPrismaWriteData(
    data: ModerationQueueItemUpsert
  ): Prisma.moderation_queue_itemsUncheckedCreateInput {
    return {
      server_id: data.serverId,
      user_id: data.userId,
      item_type: data.itemType as moderation_queue_item_type,
      verification_event_id: data.verificationEventId ?? undefined,
      detection_event_id: data.detectionEventId ?? undefined,
      report_intake_id: data.reportIntakeId ?? undefined,
      source_thread_id: data.sourceThreadId ?? undefined,
      queue_channel_id: data.queueChannelId ?? undefined,
      queue_message_id: data.queueMessageId ?? undefined,
      last_source_message_id: data.lastSourceMessageId ?? undefined,
      last_notified_at: data.lastNotifiedAt ?? undefined,
      metadata: data.metadata === undefined ? undefined : (data.metadata as Prisma.InputJsonValue),
    };
  }
}
