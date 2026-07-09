import { redirect } from 'next/navigation';
import { CaseHistoryView } from '@/components/cases/CaseHistoryView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

export default async function CaseHistoryPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/history`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const activeCaseDataAdapter = createActiveCaseDataAdapter();
  const [cases, totalResolvedCaseCount] = await Promise.all([
    activeCaseDataAdapter.listResolvedCases(guildId),
    activeCaseDataAdapter.countResolvedCases(guildId),
  ]);

  return (
    <CaseHistoryView
      cases={cases}
      guildId={guildId}
      guildName={guild.name}
      sessionUsername={session.username}
      totalResolvedCaseCount={totalResolvedCaseCount}
    />
  );
}
