import { redirect } from 'next/navigation';
import { CaseQueueView } from '@/components/cases/CaseQueueView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

export default async function ActiveCasesPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/cases`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const activeCaseDataAdapter = createActiveCaseDataAdapter();
  const [cases, resolvedCaseCount] = await Promise.all([
    activeCaseDataAdapter.listActiveCases(guildId),
    activeCaseDataAdapter.countResolvedCases(guildId),
  ]);

  return (
    <CaseQueueView
      cases={cases}
      guildId={guildId}
      guildName={guild.name}
      resolvedCaseCount={resolvedCaseCount}
      sessionUsername={session.username}
    />
  );
}
