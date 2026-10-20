import {
  createAttentionActions,
  createReportReviewActions,
  type ReportReviewActions,
  type AttentionActions,
} from '@drasil/application';
import {
  PostgresQueueAttentionRepository,
  createWebAttentionMessageDeleter,
  createWebAuthority,
} from './adapters/attention';

import {
  PostgresReportReviewRepository,
  PostgresReportReviewQueueRepository,
  PostgresReportOpenCaseRepository,
  PostgresQueuedReportCaseOpener,
  createReportReviewMessageDeleter,
} from './adapters/reportReview';
import { createSetupDataAdapter } from '../setupDataAdapter';

export interface WebApplication {
  readonly reportReview: ReportReviewActions;
  readonly attention: AttentionActions;
}
export function createWebApplication(): WebApplication {
  const authority = createWebAuthority();
  return {
    reportReview: createReportReviewActions({
      authority,
      staffRoles: {
        async loadRoleIds(guildId) {
          return (
            (await createSetupDataAdapter().getServer(guildId))?.settings.case_responder_role_ids ??
            []
          );
        },
      },
      repository: new PostgresReportReviewRepository(),
      queueRepository: new PostgresReportReviewQueueRepository(),
      queueMessageDeleter: createReportReviewMessageDeleter(),
      openCaseRepository: new PostgresReportOpenCaseRepository(),
      reportCaseOpener: new PostgresQueuedReportCaseOpener(),
    }),
    attention: createAttentionActions({
      repository: new PostgresQueueAttentionRepository(),
      authority,
      messageDeleter: createWebAttentionMessageDeleter(),
    }),
  };
}
