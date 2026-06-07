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
  const cases = await createActiveCaseDataAdapter().listActiveCases(guildId);

  return (
    <CaseQueueView
      cases={cases}
      guildId={guildId}
      guildName={guild.name}
      sessionUsername={session.username}
    />
  );
}
