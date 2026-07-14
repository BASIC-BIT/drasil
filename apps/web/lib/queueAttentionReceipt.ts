import type { QueueAttentionAcknowledgeStatus } from '../../../src/services/QueueAttentionService';

export interface QueueAttentionAcknowledgementSummary {
  readonly acknowledgedCount: number;
  readonly alreadyHandledCount: number;
}

export function summarizeQueueAttentionAcknowledgements(
  statuses: readonly QueueAttentionAcknowledgeStatus[]
): QueueAttentionAcknowledgementSummary {
  return statuses.reduce<QueueAttentionAcknowledgementSummary>(
    (summary, status) => ({
      acknowledgedCount: summary.acknowledgedCount + (status === 'acknowledged' ? 1 : 0),
      alreadyHandledCount: summary.alreadyHandledCount + (status === 'already_handled' ? 1 : 0),
    }),
    { acknowledgedCount: 0, alreadyHandledCount: 0 }
  );
}

export function formatQueueAttentionAcknowledgement(
  summary: QueueAttentionAcknowledgementSummary
): string {
  const totalCount = summary.acknowledgedCount + summary.alreadyHandledCount;
  if (totalCount === 1) {
    return summary.acknowledgedCount === 1 ? 'Reply acknowledged.' : 'Reply was already handled.';
  }
  if (summary.alreadyHandledCount === 0) {
    return `${summary.acknowledgedCount} replies acknowledged.`;
  }
  if (summary.acknowledgedCount === 0) {
    return `${summary.alreadyHandledCount} replies were already handled.`;
  }
  return `${summary.acknowledgedCount} replies acknowledged; ${summary.alreadyHandledCount} already handled.`;
}
