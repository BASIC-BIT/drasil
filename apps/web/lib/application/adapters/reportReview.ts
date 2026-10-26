import { createReportClosureResources, createReportResources } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../mcp/adapters/database';
import type {
  ActionContext,
  ReportCaseOpener,
  ReportCaseOpenResult,
  ReportOpenCaseCandidate,
  ReportOpenCaseRepository,
  ReportReviewQueueRepository,
  ReportReviewRepository,
  QueueMessageDeleter,
} from '@drasil/application';
import { deleteBotMessage } from '../../discordApi';
import { submitQueuedAction } from '../queuedSubmission';

export class PostgresReportReviewRepository implements ReportReviewRepository {
  closeSubmittedReport(input: Parameters<ReportReviewRepository['closeSubmittedReport']>[0]) {
    return createReportClosureResources(
      createWebDelegationDatabase()
    ).repository.closeSubmittedReport(input);
  }
}
export class PostgresReportReviewQueueRepository implements ReportReviewQueueRepository {
  deleteReportThreadAttention(id: string) {
    return createReportClosureResources(
      createWebDelegationDatabase()
    ).queueRepository.deleteReportThreadAttention(id);
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
