import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, moderation_queue_item_type } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import { ModerationQueueItem, ModerationQueueItemType, ModerationQueueItemUpsert } from './types';

export interface IModerationQueueRepository {
  findById(id: string): Promise<ModerationQueueItem | null>;
  findByCase(verificationEventId: string): Promise<ModerationQueueItem | null>;
  listByCase(verificationEventId: string): Promise<ModerationQueueItem[]>;
  listByVerificationEvent(verificationEventId: string): Promise<ModerationQueueItem[]>;
  findByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem | null>;
  listByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem[]>;
  listByReportIntake(reportIntakeId: string): Promise<ModerationQueueItem[]>;
  findByPendingScreeningMember(
    serverId: string,
    userId: string
  ): Promise<ModerationQueueItem | null>;
  findAttentionByThread(
    itemType: ModerationQueueItemType,
    sourceThreadId: string
  ): Promise<ModerationQueueItem | null>;
  findAttentionByVerificationEvent(
    itemType: ModerationQueueItemType,
    verificationEventId: string
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

  async listByCase(verificationEventId: string): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: {
          item_type: ModerationQueueItemType.CASE_MIRROR as moderation_queue_item_type,
          verification_event_id: verificationEventId,
        },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByCase');
    }
  }

  async listByVerificationEvent(verificationEventId: string): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: { verification_event_id: verificationEventId },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByVerificationEvent');
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

  async listByObservedAlert(detectionEventId: string): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: {
          item_type: ModerationQueueItemType.OBSERVED_ALERT_MIRROR as moderation_queue_item_type,
          detection_event_id: detectionEventId,
        },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByObservedAlert');
    }
  }

  async listByReportIntake(reportIntakeId: string): Promise<ModerationQueueItem[]> {
    try {
      const items = await this.prisma.moderation_queue_items.findMany({
        where: { report_intake_id: reportIntakeId },
      });
      return items as ModerationQueueItem[];
    } catch (error) {
      this.handleError(error, 'listModerationQueueItemsByReportIntake');
    }
  }

  async findByPendingScreeningMember(
    serverId: string,
    userId: string
  ): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findFirst({
        where: {
          server_id: serverId,
          user_id: userId,
          item_type: ModerationQueueItemType.PENDING_SCREENING_MEMBER as moderation_queue_item_type,
        },
      });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueItemByPendingScreeningMember');
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

  async findAttentionByVerificationEvent(
    itemType: ModerationQueueItemType,
    verificationEventId: string
  ): Promise<ModerationQueueItem | null> {
    try {
      const item = await this.prisma.moderation_queue_items.findFirst({
        where: {
          item_type: itemType as moderation_queue_item_type,
          verification_event_id: verificationEventId,
        },
      });
      return item as ModerationQueueItem | null;
    } catch (error) {
      this.handleError(error, 'findModerationQueueAttentionByVerificationEvent');
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
      if (
        data.itemType === ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION &&
        data.verificationEventId
      ) {
        return await this.upsertQuarantineBreach(data);
      }
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

  private async findExistingItem(
    data: ModerationQueueItemUpsert
  ): Promise<ModerationQueueItem | null> {
    if (data.itemType === ModerationQueueItemType.CASE_MIRROR && data.verificationEventId) {
      return this.findByCase(data.verificationEventId);
    }
    if (data.itemType === ModerationQueueItemType.OBSERVED_ALERT_MIRROR && data.detectionEventId) {
      return this.findByObservedAlert(data.detectionEventId);
    }
    if (data.itemType === ModerationQueueItemType.PENDING_SCREENING_MEMBER) {
      return this.findByPendingScreeningMember(data.serverId, data.userId);
    }
    if (
      (data.itemType === ModerationQueueItemType.SUPPORT_THREAD_ATTENTION ||
        data.itemType === ModerationQueueItemType.REPORT_THREAD_ATTENTION) &&
      data.sourceThreadId
    ) {
      return this.findAttentionByThread(data.itemType, data.sourceThreadId);
    }
    if (
      data.itemType === ModerationQueueItemType.QUARANTINE_BREACH_ATTENTION &&
      data.verificationEventId
    ) {
      return this.findAttentionByVerificationEvent(data.itemType, data.verificationEventId);
    }

    return null;
  }

  private async upsertQuarantineBreach(
    data: ModerationQueueItemUpsert
  ): Promise<ModerationQueueItem> {
    if (!data.verificationEventId || !data.sourceThreadId) {
      throw new Error('Quarantine breach attention requires a case and source channel.');
    }
    const metadata = JSON.stringify(data.metadata ?? {});
    const rows = await this.prisma.$queryRaw<ModerationQueueItem[]>(Prisma.sql`
      INSERT INTO "moderation_queue_items" (
        "server_id",
        "user_id",
        "item_type",
        "verification_event_id",
        "source_thread_id",
        "queue_channel_id",
        "queue_message_id",
        "last_source_message_id",
        "last_notified_at",
        "metadata"
      ) VALUES (
        ${data.serverId},
        ${data.userId},
        ${data.itemType}::"moderation_queue_item_type",
        ${data.verificationEventId}::uuid,
        ${data.sourceThreadId},
        ${data.queueChannelId ?? null},
        ${data.queueMessageId ?? null},
        ${data.lastSourceMessageId ?? null},
        ${data.lastNotifiedAt ?? null},
        ${metadata}::jsonb
      )
      ON CONFLICT ("item_type", "verification_event_id")
        WHERE "verification_event_id" IS NOT NULL
      DO UPDATE SET
        "server_id" = EXCLUDED."server_id",
        "user_id" = EXCLUDED."user_id",
        "source_thread_id" = EXCLUDED."source_thread_id",
        "queue_channel_id" = COALESCE(
          EXCLUDED."queue_channel_id",
          "moderation_queue_items"."queue_channel_id"
        ),
        "queue_message_id" = COALESCE(
          EXCLUDED."queue_message_id",
          "moderation_queue_items"."queue_message_id"
        ),
        "last_source_message_id" = EXCLUDED."last_source_message_id",
        "last_notified_at" = COALESCE(
          "moderation_queue_items"."last_notified_at",
          EXCLUDED."last_notified_at"
        ),
        "metadata" = EXCLUDED."metadata",
        "updated_at" = now()
      RETURNING *
    `);
    if (!rows[0]) {
      throw new Error('Quarantine breach attention upsert returned no row.');
    }
    return rows[0];
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
