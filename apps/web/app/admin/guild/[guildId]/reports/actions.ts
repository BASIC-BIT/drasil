'use server';

import { createWebActionContext } from '@/lib/application/context';
import { submitQueuedAction } from '@/lib/application/queuedSubmission';
import { fetchGuildResources } from '@/lib/discordApi';
import {
  DISCORD_PERMISSIONS,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from '@/lib/discordPermissions';
import { failedInboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import { createReportDetailDataAdapter } from '@/lib/reportDetailDataAdapter';
import {
  createReportQueueDataAdapter,
  type ReportClosureAction,
} from '@/lib/reportQueueDataAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import { assertWorkspaceConfirmation, resolveWorkspaceReturnTo } from '@/lib/workspaceConfirmation';
import type {
  CloseSubmittedReportResult,
  OpenSubmittedReportCaseResult,
} from '@drasil/application';
import { isReportClosureAction } from '@drasil/application';
import { reportQueueActionSchema } from '@drasil/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

async function performCloseSubmittedReport(
  guildId: string,
  reportId: string,
  action: ReportClosureAction,
  returnTo: string,
  workspaceForm: FormData
): Promise<CloseSubmittedReportResult> {
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
  await assertCurrentWorkspaceReport(guildId, reportId, parsedAction, workspaceForm);
  const closed = await createReportQueueDataAdapter().closeSubmittedReport(
    createWebActionContext({ guildId, userId: session.userId }),
    {
      reportId,
      action: parsedAction,
    }
  );

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);
  return closed;
}
async function performBanSubmittedReport(
  guildId: string,
  reportId: string,
  formData: FormData,
  returnTo: string
): Promise<ModerationActionRequestReceipt> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) redirect(`/api/auth/discord?returnTo=${returnTo}`);
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
  assertWorkspaceConfirmation(formData, {
    recordId: detail.id,
    targetUserId: detail.targetUserId,
  });
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
  const receipt = await submitQueuedAction({
    context: createWebActionContext({
      guildId,
      userId: session.userId,
      requestId: detail.latestDetectionId,
      source: 'web_report',
    }),
    command: {
      kind: 'ban_observed_detection',
      targetUserId: detail.targetUserId,
      detectionEventId: detail.latestDetectionId,
      subject: { kind: 'report', reportId },
      reason: reason || null,
    },
  });
  revalidatePath(`/admin/guild/${guildId}/reports/${reportId}`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/inbox`);
  return receipt;
}

async function performOpenSubmittedReportCase(
  guildId: string,
  reportId: string,
  returnTo: string,
  workspaceForm: FormData
): Promise<OpenSubmittedReportCaseResult> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=${returnTo}`);
  }

  await createSetupDashboardService().assertCanManageGuild(guildId, token.accessToken);
  await assertCurrentWorkspaceReport(guildId, reportId, 'open_case', workspaceForm);
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

  return result;
}

async function assertCurrentWorkspaceReport(
  guildId: string,
  reportId: string,
  action: Parameters<WorkspaceActions['reportAction']>[0]['action'],
  formData: FormData
): Promise<void> {
  const detail = await createReportDetailDataAdapter().getReportDetail(guildId, reportId);
  if (
    !detail ||
    detail.id !== reportId ||
    detail.guildId !== guildId ||
    !detail.allowedActions.includes(action)
  )
    throw new Error('Report action is no longer available. Refresh the report before continuing.');
  assertWorkspaceConfirmation(formData, { recordId: detail.id, targetUserId: detail.targetUserId });
}
export async function submitWorkspaceReportAction(
  input: Parameters<WorkspaceActions['reportAction']>[0],
  formData: FormData
): ReturnType<WorkspaceActions['reportAction']> {
  try {
    const { guildId, reportId, action } = input;
    const returnTo = encodeURIComponent(
      resolveWorkspaceReturnTo(formData, guildId, `/admin/guild/${guildId}/reports/${reportId}`)
    );
    if (isReportClosureAction(action))
      return {
        kind: 'report_closure',
        result: await performCloseSubmittedReport(guildId, reportId, action, returnTo, formData),
      };
    if (action === 'open_case')
      return {
        kind: 'report_open',
        result: await performOpenSubmittedReportCase(guildId, reportId, returnTo, formData),
      };
    if (action === 'ban_user')
      return {
        kind: 'request',
        receipt: await performBanSubmittedReport(guildId, reportId, formData, returnTo),
      };
    throw new Error('Unsupported report action.');
  } catch (error) {
    return {
      kind: 'failed',
      message: failedInboxActionState(error).message ?? 'Action response unavailable.',
    };
  }
}
