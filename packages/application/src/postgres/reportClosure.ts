import type {
  ReportReviewRepository,
  ReportReviewQueueRepository,
  ReportReviewClosureStatus,
  ReportReviewRecord,
} from '../reports/review';
import type { QueueAttentionItemRecord } from '../operations/attention';
import type { DelegationQueryClient } from './delegation';
export function createReportClosureResources(database: DelegationQueryClient): {
  repository: ReportReviewRepository;
  queueRepository: ReportReviewQueueRepository;
} {
  const repository: ReportReviewRepository = {
    async closeSubmittedReport(input: {
      reportId: string;
      serverId: string;
      status: ReportReviewClosureStatus;
      closedAt: Date;
      metadata: Record<string, unknown>;
    }): Promise<ReportReviewRecord | null> {
      const result = await database.query<ReportReviewRecord & Record<string, unknown>>(
        `update report_intakes
       set status = $3,
           closed_at = $4,
           updated_at = $4,
           metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb
       where id = $1 and server_id = $2 and status = 'submitted'
         and coalesce(metadata->>'report_ban_operation_id', '') = ''
       returning id, server_id, thread_id, status`,
        [
          input.reportId,
          input.serverId,
          input.status,
          input.closedAt,
          JSON.stringify(input.metadata),
        ]
      );
      if (result.rows[0]) return result.rows[0];
      const busy = await database.query<ReportReviewRecord & Record<string, unknown>>(
        `select id, server_id, thread_id, status, true as busy from report_intakes where id = $1 and server_id = $2 and coalesce(metadata->>'report_ban_operation_id', '') <> ''`,
        [input.reportId, input.serverId]
      );
      return busy.rows[0] ?? null;
    },
  };

  const queueRepository: ReportReviewQueueRepository = {
    async deleteReportThreadAttention(reportIntakeId: string): Promise<QueueAttentionItemRecord[]> {
      const result = await database.query<QueueAttentionItemRecord & Record<string, unknown>>(
        `delete from moderation_queue_items
       where report_intake_id = $1 and item_type = 'report_thread_attention'
       returning id, server_id, item_type, queue_channel_id, queue_message_id`,
        [reportIntakeId]
      );
      return result.rows;
    },
  };

  return { repository, queueRepository };
}
