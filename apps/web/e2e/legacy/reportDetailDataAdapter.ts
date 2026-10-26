// Explicit legacy test-build boundary. Never imported by the release build.
import { readFixtureReportBan } from '@/lib/reportBanFixtures';
import { fixtureReportDetail } from '@/lib/reportFixtures';
import { type ReportDetail } from '@drasil/contracts';
import { type ReportDetailDataAdapter } from '../../lib/reportDetailDataAdapter';
export * from '../../lib/reportDetailDataAdapter';

export class FixtureReportDetailDataAdapter implements ReportDetailDataAdapter {
  public async getReportDetail(_guildId: string, reportId: string): Promise<ReportDetail | null> {
    const detail = fixtureReportDetail(reportId);
    const request = await readFixtureReportBan();
    if (
      detail &&
      request?.reportIntakeId === reportId &&
      request.observedBanResult?.status === 'banned'
    ) {
      return {
        ...detail,
        status: 'actioned',
        closedAt: request.completedAt,
        allowedActions: ['open_report_thread'],
      };
    }
    return detail;
  }
}

export function createReportDetailDataAdapter(): ReportDetailDataAdapter {
  return new FixtureReportDetailDataAdapter();
}
