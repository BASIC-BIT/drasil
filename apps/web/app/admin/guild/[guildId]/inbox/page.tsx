import { redirect } from 'next/navigation';
import { ModerationInboxView } from '@/components/inbox/ModerationInboxView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { createModerationInboxDataAdapter } from '@/lib/moderationInboxDataAdapter';
import { createModerationActionRequestDataAdapter } from '@/lib/moderationActionRequestDataAdapter';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import {
  acknowledgeInboxQueueAttentionItem,
  acknowledgeInboxQueueAttentionItems,
  queueInboxObservedAlertAction,
} from './actions';
import { queueCaseAction, queueInboxCaseAction } from '../cases/actions';
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
