import type { AuthorityPort } from '../authorization';
import type { QueueMessageDeleter } from '../operations/attention';
import type {
  ReportReviewRepository,
  ReportReviewQueueRepository,
  ReportOpenCaseRepository,
  ReportCaseOpener,
} from './review';

export interface ReportReviewDependencies {
  readonly authority: AuthorityPort;
  readonly staffRoles: { loadRoleIds(guildId: string): Promise<readonly string[]> };
  readonly repository: ReportReviewRepository;
  readonly queueRepository: ReportReviewQueueRepository | null;
  readonly queueMessageDeleter: QueueMessageDeleter | null;
  readonly openCaseRepository: ReportOpenCaseRepository | null;
  readonly reportCaseOpener: ReportCaseOpener | null;
}
