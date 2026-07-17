import { notFound, redirect } from 'next/navigation';
import { MessageCleanupJobDetail } from '@/components/cases/MessageCleanupJobDetail';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { createMessageCleanupDataAdapter } from '@/lib/messageCleanupDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

type PageProps = {
  readonly params: Promise<{
    readonly guildId: string;
    readonly caseId: string;
    readonly jobId: string;
  }>;
};

export default async function MessageCleanupJobPage({ params }: PageProps) {
  const { guildId, caseId, jobId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(
      `/api/auth/discord?returnTo=/admin/guild/${guildId}/cases/${caseId}/message-cleanup/${jobId}`
    );
  }

  const guild = await createSetupDashboardService().assertCanManageGuild(
    guildId,
    token.accessToken
  );
  const isAdministrator =
    guild.owner ||
    hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator);
  if (!isAdministrator) {
    notFound();
  }

  const detail = await createMessageCleanupDataAdapter().getJobDetail(guildId, caseId, jobId);
  if (!detail) {
    notFound();
  }

  return (
    <MessageCleanupJobDetail
      detail={detail}
      guildName={guild.name}
      sessionUsername={session.username}
    />
  );
}
