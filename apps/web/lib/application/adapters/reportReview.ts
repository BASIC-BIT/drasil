import { createReportResources } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../mcp/adapters/database';
import type {
  ActionContext,
  QueueAttentionItemRecord,
  ReportCaseOpener,
  ReportCaseOpenResult,
  ReportOpenCaseCandidate,
  ReportOpenCaseRepository,
  ReportReviewClosureStatus,
  ReportReviewQueueRepository,
  ReportReviewRecord,
  ReportReviewRepository,
  QueueMessageDeleter,
} from '@drasil/application';
import { deleteBotMessage } from '../../discordApi';
import { submitQueuedAction } from '../queuedSubmission';
import { getPostgresPool } from '../../setupDataAdapter';

export class PostgresReportReviewRepository implements ReportReviewRepository {
  public async closeSubmittedReport(input: {
    reportId: string;
    serverId: string;
    status: ReportReviewClosureStatus;
    closedAt: Date;
    metadata: Record<string, unknown>;
  }): Promise<ReportReviewRecord | null> {
    const result = await getPostgresPool().query<ReportReviewRecord>(
      `update report_intakes
       set status = $3,
           closed_at = $4,
           updated_at = $4,
           metadata = coalesce(metadata, '{}'::jsonb) || $5::jsonb
       where id = $1 and server_id = $2 and status = 'submitted'
         and coalesce(metadata->>'report_ban_operation_id', '') = ''
       returning id, server_id, thread_id, status`,
      [input.reportId, input.serverId, input.status, input.closedAt, JSON.stringify(input.metadata)]
    );
    if (result.rows[0]) return result.rows[0];
    const busy = await getPostgresPool().query<ReportReviewRecord>(
      `select id, server_id, thread_id, status, true as busy from report_intakes where id = $1 and server_id = $2 and coalesce(metadata->>'report_ban_operation_id', '') <> ''`,
      [input.reportId, input.serverId]
    );
    return busy.rows[0] ?? null;
  }
}

export class PostgresReportReviewQueueRepository implements ReportReviewQueueRepository {
  public async deleteReportThreadAttention(
    reportIntakeId: string
  ): Promise<QueueAttentionItemRecord[]> {
    const result = await getPostgresPool().query<QueueAttentionItemRecord>(
      `delete from moderation_queue_items
       where report_intake_id = $1 and item_type = 'report_thread_attention'
       returning id, server_id, item_type, queue_channel_id, queue_message_id`,
      [reportIntakeId]
    );
    return result.rows;
  }
}

export class PostgresReportOpenCaseRepository implements ReportOpenCaseRepository {
  public async findSubmittedReportCaseCandidate(input: {
    reportId: string;
    serverId: string;
  }): Promise<ReportOpenCaseCandidate | null> {
    return createReportResources(
      createWebDelegationDatabase()
    ).openCaseRepository.findSubmittedReportCaseCandidate(input);
  }
}

export class PostgresQueuedReportCaseOpener implements ReportCaseOpener {
  public async openObservedDetectionCase(
    context: ActionContext,
    input: {
      detectionEventId: string;
      reportId: string;
      userId: string;
    }
  ): Promise<ReportCaseOpenResult> {
    const receipt = await submitQueuedAction({
      context,
      command: {
        kind: 'open_case_from_observed_detection',
        detectionEventId: input.detectionEventId,
        targetUserId: input.userId,
        reportId: input.reportId,
      },
    });
    if (receipt.status === 'failed') {
      throw new Error('Report case action could not be queued. Refresh the inbox and try again.');
    }
    return {
      requestId: receipt.id,
      status: receipt.status === 'completed' ? 'already_handled' : 'queued',
    };
  }
}

export function createReportReviewMessageDeleter(): QueueMessageDeleter {
  return {
    async deleteQueueMessage(item): Promise<void> {
      if (item.queue_channel_id && item.queue_message_id)
        await deleteBotMessage(item.queue_channel_id, item.queue_message_id);
    },
  };
}
