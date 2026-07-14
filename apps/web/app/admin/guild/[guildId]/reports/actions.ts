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
import {
  completedInboxActionState,
  failedInboxActionState,
  queuedInboxActionState,
  type InboxActionState,
} from '@/lib/inboxActionState';

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
  const closed = await createReportQueueDataAdapter().closeSubmittedReport({
    guildId,
    reportId,
    action: parsedAction as ReportClosureAction,
    adminId: session.userId,
  });

  if (!closed) {
    throw new Error('Report is no longer available to close. Refresh the queue and try again.');
  }

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);
}

export async function closeInboxSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction,
  _previousState: InboxActionState,
  _formData: FormData
): Promise<InboxActionState> {
  try {
    await closeSubmittedReport(guildId, reportId, action);
    return completedInboxActionState('Report action completed.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}

const openCaseErrorMessages = {
  already_handled: 'Report is no longer available to open. Refresh the queue and try again.',
  case_exists: 'Report already has a linked case.',
  missing_detection: 'Report does not have a linked detection event to open as a case.',
  missing_target: 'Report does not have a confirmed target user to open as a case.',
  opener_unavailable: 'Opening report cases from the web UI is not enabled in this environment.',
} as const;

export async function openSubmittedReportCase(guildId: string, reportId: string): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/reports/${reportId}`);
  }

  const parsedAction = reportQueueActionSchema.parse('open_case');
  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  const result = await createReportQueueDataAdapter().openCaseFromSubmittedReport({
    guildId,
    reportId,
    adminId: session.userId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);

  if (result.status === 'opened') {
    if (result.caseId) {
      redirect(`/admin/guild/${guildId}/cases/${result.caseId}`);
    }
    return;
  }
  if (result.status === 'queued') {
    return;
  }
  if (result.status === 'case_exists' && result.caseId) {
    redirect(`/admin/guild/${guildId}/cases/${result.caseId}`);
  }

  throw new Error(
    openCaseErrorMessages[result.status] ?? `Unsupported report action: ${parsedAction}`
  );
}

export async function openInboxSubmittedReportCase(
  guildId: string,
  reportId: string,
  _previousState: InboxActionState,
  _formData: FormData
): Promise<InboxActionState> {
  try {
    const [session, token] = await Promise.all([
      getCurrentAdminSession(),
      getCurrentDiscordToken(),
    ]);
    if (!session || !token) {
      redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
    }

    await createSetupDashboardService().assertCanManageGuild(guildId, token.accessToken);
    const result = await createReportQueueDataAdapter().openCaseFromSubmittedReport({
      guildId,
      reportId,
      adminId: session.userId,
    });

    revalidatePath(`/admin/guild/${guildId}/inbox`);
    revalidatePath(`/admin/guild/${guildId}/cases`);
    revalidatePath(`/admin/guild/${guildId}/reports`);
    revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);

    if (result.status === 'queued' && result.requestId) {
      return queuedInboxActionState(
        { id: result.requestId, status: 'queued' },
        'Open case queued.'
      );
    }
    if (result.status === 'queued') {
      throw new Error('Drasil did not return an action request receipt.');
    }
    if (result.status === 'opened' || result.status === 'case_exists') {
      return completedInboxActionState(
        result.status === 'opened' ? 'Case opened.' : 'A linked case already exists.'
      );
    }

    throw new Error(
      openCaseErrorMessages[result.status] ?? `Unsupported report action: ${result.action}`
    );
  } catch (error) {
    return failedInboxActionState(error);
  }
}
