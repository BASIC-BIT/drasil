// Explicit legacy test-build boundary. Never imported by the release build.
import { readFixtureReportBan } from '@/lib/reportBanFixtures';
import { fixtureSubmittedReports } from '@/lib/reportFixtures';
import type {
  ActionContext,
  CloseSubmittedReportResult,
  OpenSubmittedReportCaseResult,
  ReportClosureAction,
} from '@drasil/application';
import { sortReportQueueItems, type ReportQueueItem } from '@drasil/contracts';
import { type ReportQueueDataAdapter } from '../../lib/reportQueueDataAdapter';
export * from '../../lib/reportQueueDataAdapter';

export class FixtureReportQueueDataAdapter implements ReportQueueDataAdapter {
  public async listSubmittedReports(): Promise<ReportQueueItem[]> {
    const request = await readFixtureReportBan();
    return sortReportQueueItems(
      fixtureSubmittedReports().filter(
        (report) =>
          request?.observedBanResult?.status !== 'banned' || request.reportIntakeId !== report.id
      )
    );
  }

  public async countClosedReports(): Promise<number> {
    return (await readFixtureReportBan())?.observedBanResult?.status === 'banned' ? 5 : 4;
  }

  public canOpenSubmittedReportCase(): boolean {
    return true;
  }

  public async closeSubmittedReport(
    context: ActionContext,
    input: { reportId: string; action: ReportClosureAction }
  ): Promise<CloseSubmittedReportResult> {
    return {
      actor: {
        id: context.actor.kind === 'user' ? context.actor.userId : '',
        surface: context.source,
      },
      action: input.action,
      reportId: input.reportId,
      reportStatus:
        input.action === 'dismiss_no_action'
          ? 'dismissed'
          : input.action === 'mark_actioned'
            ? 'actioned'
            : 'false_positive',
      status: 'closed',
      queueCleanupStatus: 'skipped',
    };
  }

  public async openCaseFromSubmittedReport(
    context: ActionContext,
    input: {
      reportId: string;
    }
  ): Promise<OpenSubmittedReportCaseResult> {
    const report = fixtureSubmittedReports().find((item) => item.id === input.reportId);
    return {
      actor: {
        id: context.actor.kind === 'user' ? context.actor.userId : '',
        surface: context.source,
      },
      action: 'open_case',
      caseId: report?.latestCaseId ?? `fixture-case-${input.reportId}`,
      detectionEventId: report?.latestDetectionId ?? null,
      reportId: input.reportId,
      requestId: `fixture-report-open-case-${input.reportId}`,
      status: report?.targetUserId && report.latestDetectionId ? 'opened' : 'missing_detection',
      targetUserId: report?.targetUserId ?? null,
      queueCleanupStatus: 'skipped',
    };
  }
}

export function createReportQueueDataAdapter(): ReportQueueDataAdapter {
  return new FixtureReportQueueDataAdapter();
}
