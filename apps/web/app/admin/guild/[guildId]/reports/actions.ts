'use server';

import { encodeQueuedAction } from '@drasil/application';

import { isReportClosureAction } from '@drasil/application';
import { createWebActionContext } from '@/lib/application/context';
import { createReportDetailDataAdapter } from '@/lib/reportDetailDataAdapter';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { fetchGuildResources } from '@/lib/discordApi';
import {
  DISCORD_PERMISSIONS,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from '@/lib/discordPermissions';
import { queueModerationActionRequestWithReceipt } from '@/lib/moderationActionRequestQueue';
import { queueFixtureReportBan } from '@/lib/reportBanFixtures';
import { isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { reportQueueActionSchema } from '@drasil/contracts';
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

async function performCloseSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction,
  returnTo: string
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=${returnTo}`);
  }

  const parsedAction = reportQueueActionSchema.parse(action);
  if (!isReportClosureAction(parsedAction)) {
    throw new Error(`Unsupported report closure action: ${parsedAction}`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  const closed = await createReportQueueDataAdapter().closeSubmittedReport(
    createWebActionContext({ guildId, userId: session.userId }),
    {
      reportId,
      action: parsedAction,
    }
  );

  if (!closed) {
    throw new Error('Report is no longer available to close. Refresh the queue and try again.');
  }

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);
}

export async function closeSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction
): Promise<void> {
  await performCloseSubmittedReport(guildId, reportId, action, `/admin/guild/${guildId}/reports`);
}

export async function closeInboxSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction,
  _previousState: InboxActionState,
  _formData: FormData
): Promise<InboxActionState> {
  try {
    await performCloseSubmittedReport(guildId, reportId, action, `/admin/guild/${guildId}/inbox`);
    return completedInboxActionState('Report action completed.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}

const openCaseErrorMessages = {
  busy: 'A ban is already being processed for this report.',
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
  const result = await createReportQueueDataAdapter().openCaseFromSubmittedReport(
    createWebActionContext({ guildId, userId: session.userId }),
    {
      reportId,
    }
  );

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
    const result = await createReportQueueDataAdapter().openCaseFromSubmittedReport(
      createWebActionContext({ guildId, userId: session.userId }),
      {
        reportId,
      }
    );

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

export async function banSubmittedReport(
  guildId: string,
  reportId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    const [session, token] = await Promise.all([
      getCurrentAdminSession(),
      getCurrentDiscordToken(),
    ]);
    if (!session || !token)
      redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/reports/${reportId}`);
    const guild = await createSetupDashboardService().assertCanManageGuild(
      guildId,
      token.accessToken
    );
    if (
      !guild.owner &&
      !hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.BanMembers)
    ) {
      throw new Error('You need Ban Members permission to ban from a report.');
    }
    const detail = await createReportDetailDataAdapter().getReportDetail(guildId, reportId);
    if (
      !detail ||
      detail.guildId !== guildId ||
      detail.status !== 'submitted' ||
      !detail.allowedActions.includes('ban_user') ||
      !detail.targetUserId ||
      !detail.latestDetectionId
    ) {
      throw new Error('Report is no longer available for a ban. Refresh the report.');
    }
    if (
      formData.get('confirmAction') !== 'on' ||
      formData.get('confirmedTargetUserId') !== detail.targetUserId
    ) {
      throw new Error('Review and confirm the current report target before queueing a ban.');
    }
    const server = await createSetupDataAdapter().getServer(guildId);
    if (server?.settings.moderator_ban_action_enabled === false)
      throw new Error('Moderator ban actions are disabled for this server.');
    const value = formData.get('reason');
    const reason = typeof value === 'string' ? value.trim() : '';
    if (reason.length > 500) throw new Error('Ban reason must be 500 characters or fewer.');
    if (server?.settings.moderator_ban_action_requires_reason === true && !reason)
      throw new Error('Ban reason is required.');
    const resources = await fetchGuildResources(guildId);
    const botPermissions = computeGuildPermissions({
      guildId,
      memberRoleIds: resources.botMember.roles,
      roles: resources.roles,
    });
    if (!hasPermission(botPermissions, DISCORD_PERMISSIONS.BanMembers))
      throw new Error('Drasil is missing Ban Members permission.');
    const receipt = isWebE2eFixtureMode()
      ? await queueFixtureReportBan(reportId)
      : await queueModerationActionRequestWithReceipt(
          encodeQueuedAction(
            {
              guildId,
              requestId: detail.latestDetectionId,
              source: 'web_report',
              actor: { kind: 'user', userId: session.userId },
            },
            {
              kind: 'ban_observed_detection',
              targetUserId: detail.targetUserId,
              detectionEventId: detail.latestDetectionId,
              subject: { kind: 'report', reportId },
              reason: reason || null,
            }
          )
        );
    revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);
    revalidatePath(`/admin/guild/${guildId}/reports`);
    revalidatePath(`/admin/guild/${guildId}/inbox`);
    return queuedInboxActionState(receipt, 'Ban queued for Drasil.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}
