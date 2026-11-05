import {
  acknowledgeIdentityReviewMetadata,
  projectReportIntakeState,
  isIdentityReviewItem,
  type QueueAttentionItemRecord,
  type QueueAttentionRepository,
} from '@drasil/application';
import { ownsPresentation } from './reportIntakeProcessing';
import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, moderation_queue_item_type } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ModerationQueueItem,
  ModerationQueueItemType,
  ModerationQueueItemUpsert,
  ReportPresentationClaim,
  ReportIntake,
} from './types';

export interface IModerationQueueRepository extends Pick<
  QueueAttentionRepository,
  'reserveOrdinaryAcknowledgement' | 'completeOrdinaryAcknowledgement'
> {
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
  upsertIdentityReview(
    data: ModerationQueueItemUpsert,
    claim: ReportPresentationClaim
  ): Promise<ModerationQueueItem | null>;
  updateDiscordMessage(
    id: string,
    queueChannelId: string | null,
    queueMessageId: string | null,
    claim?: ReportPresentationClaim
  ): Promise<ModerationQueueItem | null>;
  acknowledgeIdentityReview(input: {
    itemId: string;
    guildId: string;
    actorId: string;
    acknowledgedAt: Date;
  }): Promise<'acknowledged' | 'already_handled'>;
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
        where: { report_intake_id: reportIntakeId, attention_cleanup_pending: false },
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
          attention_cleanup_pending: false,
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
          attention_cleanup_pending: false,
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

  async upsertIdentityReview(
    data: ModerationQueueItemUpsert,
    claim: ReportPresentationClaim
  ): Promise<ModerationQueueItem | null> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        // Serialize identity metadata and send reservations with resolution and evidence revisions.
        const rows = await transaction.$queryRaw<
          ReportIntake[]
        >`SELECT * FROM report_intakes WHERE id=${claim.intake.id}::uuid FOR UPDATE`;
        const intake = rows.at(0);
        if (
          !intake ||
          !ownsPresentation(intake, claim, new Date()) ||
          intake.status !== 'needs_admin_confirmation' ||
          data.reportIntakeId !== intake.id ||
          data.serverId !== intake.server_id ||
          data.userId !== intake.reporter_id ||
          data.itemType !== ModerationQueueItemType.REPORT_THREAD_ATTENTION ||
          data.sourceThreadId !== intake.thread_id
        )
          return null;
        const existing = await transaction.moderation_queue_items.findFirst({
          where: {
            item_type: data.itemType,
            server_id: intake.server_id,
            attention_cleanup_pending: false,
            OR: [
              { report_intake_id: intake.id },
              ...(intake.thread_id ? [{ source_thread_id: intake.thread_id }] : []),
            ],
          },
        });
        const writeData = this.toPrismaWriteData(data);
        if (existing) {
          const updated = await transaction.moderation_queue_items.updateManyAndReturn({
            where: { id: existing.id, attention_cleanup_pending: false },
            data: { ...writeData, updated_at: new Date() },
          });
          if (updated[0]) return updated[0] as ModerationQueueItem;
        }
        return (await transaction.moderation_queue_items.create({
          data: writeData,
        })) as ModerationQueueItem;
      });
    } catch (error) {
      this.handleError(error, 'upsertReportIdentityReview');
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
        const updated = await this.prisma.moderation_queue_items.updateManyAndReturn({
          where: { id: existing.id, attention_cleanup_pending: false },
          data: {
            ...writeData,
            updated_at: new Date(),
          },
        });
        if (updated[0]) return updated[0] as ModerationQueueItem;
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
    queueMessageId: string | null,
    claim?: ReportPresentationClaim
  ): Promise<ModerationQueueItem | null> {
    try {
      if (claim)
        return await this.prisma.$transaction(async (transaction) => {
          // Match the report-first lock order used by report actions and presentation completion.
          const rows = await transaction.$queryRaw<
            ReportIntake[]
          >`SELECT * FROM report_intakes WHERE id = ${claim.intake.id}::uuid FOR UPDATE`;
          const intake = rows[0];
          if (!intake || !ownsPresentation(intake, claim, new Date())) return null;
          const updated = await transaction.moderation_queue_items.updateMany({
            where: {
              id,
              attention_cleanup_pending: false,
              report_intake_id: intake.id,
              server_id: intake.server_id,
              item_type: ModerationQueueItemType.REPORT_THREAD_ATTENTION,
            },
            data: {
              queue_channel_id: queueChannelId,
              queue_message_id: queueMessageId,
              updated_at: new Date(),
            },
          });
          if (!updated.count) return null;
          return (await transaction.moderation_queue_items.findUnique({
            where: { id },
          })) as ModerationQueueItem | null;
        });

      const updated = await this.prisma.moderation_queue_items.updateManyAndReturn({
        where: { id, attention_cleanup_pending: false },
        data: {
          queue_channel_id: queueChannelId,
          queue_message_id: queueMessageId,
          updated_at: new Date(),
        },
      });
      return (updated[0] as ModerationQueueItem | undefined) ?? null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'updateModerationQueueDiscordMessage');
    }
  }

  async reserveOrdinaryAcknowledgement(
    itemId: string,
    guildId: string
  ): Promise<QueueAttentionItemRecord | null> {
    const rows = await this.prisma.$queryRaw<ModerationQueueItem[]>`
      UPDATE moderation_queue_items SET attention_cleanup_pending = true, updated_at = now(),
        metadata = CASE WHEN attention_cleanup_pending THEN metadata ELSE
          jsonb_set(COALESCE(metadata, '{}'::jsonb), '{attention_cleanup}', jsonb_build_object(
            'source_thread_id', source_thread_id, 'verification_event_id', verification_event_id,
            'detection_event_id', detection_event_id)) END,
        source_thread_id = NULL, verification_event_id = NULL, detection_event_id = NULL
      WHERE id = ${itemId}::uuid AND server_id = ${guildId}
        AND item_type IN ('support_thread_attention', 'report_thread_attention', 'quarantine_breach_attention')
        AND NOT (item_type = 'report_thread_attention' AND report_intake_id IS NOT NULL
          AND COALESCE(jsonb_typeof(metadata->'identity_review') = 'object', false))
      RETURNING *`;
    return rows.at(0) ?? this.findById(itemId);
  }

  async completeOrdinaryAcknowledgement(item: QueueAttentionItemRecord): Promise<boolean> {
    const deleted = await this.prisma.moderation_queue_items.deleteMany({
      where: {
        id: item.id,
        server_id: item.server_id,
        attention_cleanup_pending: true,
        queue_channel_id: item.queue_channel_id,
        queue_message_id: item.queue_message_id,
      },
    });
    return deleted.count > 0;
  }

  async acknowledgeIdentityReview(input: {
    itemId: string;
    guildId: string;
    actorId: string;
    acknowledgedAt: Date;
  }): Promise<'acknowledged' | 'already_handled'> {
    return this.prisma.$transaction(async (transaction) => {
      const snapshot = await transaction.moderation_queue_items.findUnique({
        where: { id: input.itemId },
      });
      if (
        !snapshot?.report_intake_id ||
        snapshot.server_id !== input.guildId ||
        !isIdentityReviewItem(snapshot)
      )
        return 'already_handled';
      // Keep report-first lock order with presentation and resolution.
      const rows = await transaction.$queryRaw<
        ReportIntake[]
      >`SELECT * FROM report_intakes WHERE id = ${snapshot.report_intake_id}::uuid FOR UPDATE`;
      const intake = rows.at(0);
      if (
        !intake ||
        intake.server_id !== input.guildId ||
        intake.status !== 'needs_admin_confirmation' ||
        intake.closed_at ||
        (intake.confirmed_target_user_id && !projectReportIntakeState(intake).submission)
      )
        return 'already_handled';
      const metadata = acknowledgeIdentityReviewMetadata(
        intake.metadata,
        input.actorId,
        input.acknowledgedAt
      );
      if (!metadata) return 'already_handled';
      const updated = await transaction.moderation_queue_items.updateMany({
        where: { id: input.itemId, server_id: input.guildId, report_intake_id: intake.id },
        data: { updated_at: input.acknowledgedAt },
      });
      if (!updated.count) return 'already_handled';
      await transaction.report_intakes.update({
        where: { id: intake.id },
        data: { metadata: metadata as Prisma.InputJsonValue, updated_at: input.acknowledgedAt },
      });
      return 'acknowledged';
    });
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
    if (data.itemType === ModerationQueueItemType.REPORT_THREAD_ATTENTION && data.reportIntakeId) {
      const existing = (await this.listByReportIntake(data.reportIntakeId)).find(
        (item) => item.item_type === data.itemType
      );
      if (existing) return existing;
    }
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
