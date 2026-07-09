import { notFound, redirect } from 'next/navigation';
import { CaseDetailView } from '@/components/cases/CaseDetailView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { fetchCaseDiscordSnapshot } from '@/lib/caseDiscordContent';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { queueCaseAction } from '../actions';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string; readonly caseId: string }>;
};

export default async function CaseDetailPage({ params }: PageProps) {
  const { guildId, caseId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/cases/${caseId}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const activeCaseDataAdapter = createActiveCaseDataAdapter();
  const detail = await activeCaseDataAdapter.getCaseDetail(guildId, caseId);
  if (!detail) {
    notFound();
  }
  const discordSnapshot = await fetchCaseDiscordSnapshot(guildId, detail);

  return (
    <CaseDetailView
      canQueueCaseActions={activeCaseDataAdapter.canQueueCaseActions()}
      detail={detail}
      discordSnapshot={discordSnapshot}
      guildId={guildId}
      guildName={guild.name}
      queueCaseAction={queueCaseAction}
      sessionUsername={session.username}
    />
  );
}
