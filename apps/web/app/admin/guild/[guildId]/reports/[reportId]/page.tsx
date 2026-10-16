import { fixtureReportBanRequest } from '@/lib/reportBanFixtures';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { InboxActionRequestPollingProvider } from '@/components/inbox/InboxActionRequestPoller';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { notFound, redirect } from 'next/navigation';
import { banSubmittedReport, closeSubmittedReport, openSubmittedReportCase } from '../actions';
import { ReportDetailView } from '@/components/reports/ReportDetailView';
import { createReportDetailDataAdapter } from '@/lib/reportDetailDataAdapter';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly searchParams: Promise<{ readonly reportBanScenario?: string }>;
  readonly params: Promise<{ readonly guildId: string; readonly reportId: string }>;
};

export default async function ReportDetailPage({ params, searchParams }: PageProps) {
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

  const [requests, server] = await Promise.all([
    createModerationActionRequestDataAdapter().listInboxRequests(guildId),
    createSetupDataAdapter().getServer(guildId),
  ]);
  const { reportBanScenario } = await searchParams;
  const scenarioRequest =
    isWebE2eFixtureMode() &&
    (reportBanScenario === 'banned_updates_pending' || reportBanScenario === 'ban_outcome_unknown')
      ? fixtureReportBanRequest(reportId, detail.targetUserId ?? 'user-300', reportBanScenario)
      : null;
  const banRequest =
    scenarioRequest ??
    requests.find(
      (request) =>
        request.reportIntakeId === reportId && request.actionType === 'ban_observed_detection'
    ) ??
    null;
  const banUnavailableReason =
    !guild.owner &&
    !hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.BanMembers)
      ? 'Requires Ban Members permission.'
      : server?.settings.moderator_ban_action_enabled === false
        ? 'Moderator ban actions are disabled for this server.'
        : null;
  return (
    <InboxActionRequestPollingProvider enabled serverRequests={banRequest ? [banRequest] : []}>
      <ReportDetailView
        banReportAction={banSubmittedReport.bind(null, guildId, reportId)}
        banRequest={banRequest}
        banRequiresReason={server?.settings.moderator_ban_action_requires_reason === true}
        banUnavailableReason={banUnavailableReason}
        canOpenReportCases={reportQueueDataAdapter.canOpenSubmittedReportCase()}
        closeReportAction={closeSubmittedReport}
        detail={detail}
        guildId={guildId}
        guildName={guild.name}
        openReportCaseAction={openSubmittedReportCase}
        sessionUsername={session.username}
      />
    </InboxActionRequestPollingProvider>
  );
}
