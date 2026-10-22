import { createWebAuthority } from './adapters/authority';
import { createWebSetupActions } from './adapters/setup';
import type { SetupUpdateActions } from '@drasil/application';
import { createWebCaptchaActions } from './adapters/captcha';
import type { CaptchaBrowserDependencies, CaptchaBrowserActions } from '@drasil/application';
import {
  createAttentionActions,
  createReportReviewActions,
  type ReportReviewActions,
  type AttentionActions,
} from '@drasil/application';
import {
  PostgresQueueAttentionRepository,
  createWebAttentionMessageDeleter,
} from './adapters/attention';

import {
  PostgresReportReviewRepository,
  PostgresReportReviewQueueRepository,
  PostgresReportOpenCaseRepository,
  PostgresQueuedReportCaseOpener,
  createReportReviewMessageDeleter,
} from './adapters/reportReview';
import { createWebStaffRoles } from './adapters/staffRoles';

export interface WebApplication {
  readonly setup: SetupUpdateActions;
  readonly reportReview: ReportReviewActions;
  readonly attention: AttentionActions;
}
export function createWebApplication(): WebApplication {
  const authority = createWebAuthority();
  return {
    setup: createWebSetupActions(),
    reportReview: createReportReviewActions({
      authority,
      staffRoles: createWebStaffRoles(),
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

export function createWebCaptchaApplication(dependencies: CaptchaBrowserDependencies): {
  readonly captcha: CaptchaBrowserActions;
} {
  return { captcha: createWebCaptchaActions(dependencies) };
}
