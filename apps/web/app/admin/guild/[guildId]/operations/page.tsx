import { redirect } from 'next/navigation';
import { OperationsView } from '@/components/operations/OperationsView';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { createOperationsIntegrityDataAdapter } from '@/lib/operationsIntegrityDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { queueModerationQueueOperationAction } from './actions';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

export default async function OperationsPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/operations`);
  }

  const setupService = createSetupDashboardService();
  const { channels, dashboard, roles } = await setupService.getDashboard(
    guildId,
    token.accessToken
  );
  const queueChannelId = dashboard.server?.settings.moderation_queue_channel_id ?? null;
  const queueChannel = channels.find((channel) => channel.id === queueChannelId);
  const queueChannelLabel = queueChannel ? `#${queueChannel.name}` : queueChannelId;
  const [integritySnapshot, recentRequests] = await Promise.all([
    createOperationsIntegrityDataAdapter().getSnapshot(guildId),
    createModerationActionRequestDataAdapter().listRecentRequests(guildId, 25),
  ]);

  return (
    <OperationsView
      guildId={guildId}
      guildName={dashboard.guildName}
      integritySnapshot={integritySnapshot}
      queueChannelLabel={queueChannelLabel}
      queueModerationQueueOperation={queueModerationQueueOperationAction}
      recentRequests={recentRequests}
      roles={roles}
      roleIntakeDefaultRoleId={dashboard.server?.settings.manual_intake_role_id ?? null}
      sessionUsername={session.username}
    />
  );
}
