import { redirect } from 'next/navigation';
import { closeSubmittedReport } from './actions';
import { ReportQueueView } from '@/components/reports/ReportQueueView';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

export default async function ReportsPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/reports`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const reportQueueDataAdapter = createReportQueueDataAdapter();
  const [reports, closedReportCount] = await Promise.all([
    reportQueueDataAdapter.listSubmittedReports(guildId),
    reportQueueDataAdapter.countClosedReports(guildId),
  ]);

  return (
    <ReportQueueView
      closeReportAction={closeSubmittedReport}
      closedReportCount={closedReportCount}
      guildId={guildId}
      guildName={guild.name}
      reports={reports}
      sessionUsername={session.username}
    />
  );
}
