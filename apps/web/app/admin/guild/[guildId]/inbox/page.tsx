import { redirect } from 'next/navigation';
import { ModerationInboxView } from '@/components/inbox/ModerationInboxView';
import { createActiveCaseDataAdapter } from '@/lib/activeCaseDataAdapter';
import { createModerationInboxDataAdapter } from '@/lib/moderationInboxDataAdapter';
import { createReportQueueDataAdapter } from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import {
  acknowledgeQueueAttentionItem,
  acknowledgeQueueAttentionItems,
  queueObservedAlertAction,
} from './actions';
import { queueCaseAction } from '../cases/actions';
import { closeSubmittedReport, openSubmittedReportCase } from '../reports/actions';

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
  const reportQueueAdapter = createReportQueueDataAdapter();
  const items = await inboxAdapter.listInboxItems(guildId);

  return (
    <ModerationInboxView
      acknowledgeQueueItemAction={acknowledgeQueueAttentionItem}
      acknowledgeQueueItemsAction={acknowledgeQueueAttentionItems}
      canOpenReportCases={reportQueueAdapter.canOpenSubmittedReportCase()}
      canQueueCaseActions={activeCaseAdapter.canQueueCaseActions()}
      closeReportAction={closeSubmittedReport}
      guildId={guildId}
      guildName={guild.name}
      items={items}
      openReportCaseAction={openSubmittedReportCase}
      queueCaseAction={queueCaseAction}
      queueObservedAlertAction={queueObservedAlertAction}
      sessionUsername={session.username}
    />
  );
}
