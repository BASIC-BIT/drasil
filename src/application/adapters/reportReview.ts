import {
  createReportReviewActions,
  type ReportReviewActions,
  type AuthorityPort,
} from '@drasil/application';
import {
  createReportClosureResources,
  createReportResources,
  type DelegationDatabase,
} from '@drasil/application/postgres';
import type { IModerationQueueService } from '../../services/ModerationQueueService';
import { createBotAttentionMessageDeleter } from './attention';
export function createBotReportReviewActions(deps: {
  database: DelegationDatabase;
  authority: AuthorityPort;
  staffRoles: { loadRoleIds(guildId: string): Promise<readonly string[]> };
  queueService: IModerationQueueService;
}): ReportReviewActions {
  return createReportReviewActions({
    authority: deps.authority,
    staffRoles: deps.staffRoles,
    ...createReportClosureResources(deps.database),
    queueMessageDeleter: createBotAttentionMessageDeleter(deps.queueService),
    openCaseRepository: createReportResources(deps.database).openCaseRepository,
    // MCP case opening is frozen queued delivery; this direct adapter never opens a second case.
    reportCaseOpener: null,
  });
}
