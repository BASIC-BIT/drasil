import { describe, expect, it, vi } from 'vitest';
import { FixtureModerationInboxDataAdapter } from '../e2e/legacy/moderationInboxDataAdapter';
import { FixtureReportQueueDataAdapter } from '../e2e/legacy/reportQueueDataAdapter';
vi.mock('./reportBanFixtures', () => ({
  readFixtureReportBan: async () => ({
    reportIntakeId: 'report-1',
    observedBanResult: { status: 'banned' },
  }),
}));
describe('completed fixture report ban attention', () => {
  it('removes the handled report from submitted reports', async () => {
    expect(
      (await new FixtureReportQueueDataAdapter().listSubmittedReports()).map((item) => item.id)
    ).not.toContain('report-1');
  });
  it('removes the handled report from inbox attention', async () => {
    expect(
      (await new FixtureModerationInboxDataAdapter().listInboxItems('guild-1'))
        .filter((item) => item.kind === 'submitted_report')
        .map((item) => item.sourceId)
    ).not.toContain('report-1');
  });
});
