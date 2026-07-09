import { notFound, redirect } from 'next/navigation';
import { closeSubmittedReport, openSubmittedReportCase } from '../actions';
import { ReportDetailView } from '@/components/reports/ReportDetailView';
import { createReportDetailDataAdapter } from '@/lib/reportDetailDataAdapter';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string; readonly reportId: string }>;
};

export default async function ReportDetailPage({ params }: PageProps) {
  const { guildId, reportId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/reports/${reportId}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const reportQueueDataAdapter = createReportQueueDataAdapter();
  const detail = await createReportDetailDataAdapter().getReportDetail(guildId, reportId);
  if (!detail) {
    notFound();
  }

  return (
    <ReportDetailView
      canOpenReportCases={reportQueueDataAdapter.canOpenSubmittedReportCase()}
      closeReportAction={closeSubmittedReport}
      detail={detail}
      guildId={guildId}
      guildName={guild.name}
      openReportCaseAction={openSubmittedReportCase}
      sessionUsername={session.username}
    />
  );
}
