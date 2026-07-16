import { redirect } from 'next/navigation';
import { ModerationInboxView } from '@/components/inbox/ModerationInboxView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { createModerationInboxDataAdapter } from '@/lib/moderationInboxDataAdapter';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { createMessageCleanupDataAdapter } from '@/lib/messageCleanupDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import {
  acknowledgeInboxQueueAttentionItem,
  acknowledgeInboxQueueAttentionItems,
  queueInboxObservedAlertAction,
} from './actions';
import { queueCaseAction, queueInboxCaseAction } from '../cases/actions';
import {
  banCaseUserWithMessageCleanup,
  executeCaseMessageCleanup,
  previewCaseMessageCleanup,
} from '../cases/messageCleanupActions';
import { closeInboxSubmittedReport, openInboxSubmittedReportCase } from '../reports/actions';

type PageProps = {
  readonly params: Promise<{ readonly guildId: string }>;
};

export default async function ModerationInboxPage({ params }: PageProps) {
  const { guildId } = await params;
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const inboxAdapter = createModerationInboxDataAdapter();
  const activeCaseAdapter = createActiveCaseDataAdapter();
  const actionRequestAdapter = createModerationActionRequestDataAdapter();
  const reportQueueAdapter = createReportQueueDataAdapter();
  const [items, recentActionRequests] = await Promise.all([
    inboxAdapter.listInboxItems(guildId),
    actionRequestAdapter.listInboxRequests(guildId, 25),
  ]);
  const isAdministrator =
    guild.owner ||
    hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator);
  const cleanupAdapter = createMessageCleanupDataAdapter();
  const caseIds = [
    ...new Set(items.filter((item) => item.kind === 'case').map((item) => item.sourceId)),
  ];
  const cleanupWorkspaces = isAdministrator
    ? await cleanupAdapter.listCaseWorkspaces(guildId, caseIds)
    : [];
  const cleanupEntries = cleanupWorkspaces.map((workspace) => {
    const caseId = workspace.verificationEventId;
    return [
      caseId,
      {
        combinedBanAction: banCaseUserWithMessageCleanup.bind(null, guildId, caseId),
        combinedJob: null,
        deleteOnlyJob: null,
        executeAction: executeCaseMessageCleanup.bind(null, guildId, caseId),
        previewAction: previewCaseMessageCleanup.bind(null, guildId, caseId),
        workspace,
      },
    ] as const;
  });

  return (
    <ModerationInboxView
      acknowledgeQueueItemAction={acknowledgeInboxQueueAttentionItem}
      acknowledgeQueueItemsAction={acknowledgeInboxQueueAttentionItems}
      canOpenReportCases={reportQueueAdapter.canOpenSubmittedReportCase()}
      canQueueCaseActions={activeCaseAdapter.canQueueCaseActions()}
      closeReportAction={closeInboxSubmittedReport}
      guildId={guildId}
      guildName={guild.name}
      items={items}
      messageCleanupByCaseId={Object.fromEntries(cleanupEntries)}
      openReportCaseAction={openInboxSubmittedReportCase}
      pollActionRequests={!isWebE2eFixtureMode()}
      queueCaseAction={queueCaseAction}
      queueInboxCaseAction={queueInboxCaseAction}
      queueObservedAlertAction={queueInboxObservedAlertAction}
      recentActionRequests={recentActionRequests}
      sessionUsername={session.username}
    />
  );
}
