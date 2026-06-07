import { notFound, redirect } from 'next/navigation';
import { CaseDetailView } from '@/components/cases/CaseDetailView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

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
  const detail = await createActiveCaseDataAdapter().getCaseDetail(guildId, caseId);
  if (!detail) {
    notFound();
  }

  return <CaseDetailView detail={detail} guildId={guildId} guildName={guild.name} />;
}
