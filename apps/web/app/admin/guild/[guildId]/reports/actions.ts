'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { reportQueueActionSchema, type ReportQueueAction } from '@drasil/contracts';
import {
  createReportQueueDataAdapter,
  type ReportClosureAction,
} from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

const closureActions = new Set<ReportQueueAction>([
  'mark_actioned',
  'dismiss_no_action',
  'mark_false_positive',
]);

export async function closeSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/reports`);
  }

  const parsedAction = reportQueueActionSchema.parse(action);
  if (!closureActions.has(parsedAction)) {
    throw new Error(`Unsupported report closure action: ${parsedAction}`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  await createReportQueueDataAdapter().closeSubmittedReport({
    guildId,
    reportId,
    action: parsedAction as ReportClosureAction,
    adminId: session.userId,
  });
  revalidatePath(`/admin/guild/${guildId}/reports`);
}
