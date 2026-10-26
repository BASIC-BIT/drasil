'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fetchDiscordGuilds } from '@/lib/discordApi';
import { submitReportRequest } from '@/lib/userReportActionQueue';
import { loadReporterOpenIntake } from '@/lib/reportIntakePortalDataAdapter';
import { createWebActionContext, createWebReportConfirmationPort } from '@/lib/application/context';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';

const DISCORD_ID_PATTERN = /^\d{15,22}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_REPORT_REASON_MAX_LENGTH = 900;

function readTrimmedFormString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTargetUserId(formData: FormData): string {
  const targetUserId = readTrimmedFormString(formData, 'targetUserId');
  if (!targetUserId || !DISCORD_ID_PATTERN.test(targetUserId)) {
    throw new Error('Enter a valid Discord user ID.');
  }
  return targetUserId;
}

function readReason(formData: FormData): string | null {
  const reason = readTrimmedFormString(formData, 'reason');
  if (reason && reason.length > USER_REPORT_REASON_MAX_LENGTH) {
    throw new Error(`Report reason must be ${USER_REPORT_REASON_MAX_LENGTH} characters or less.`);
  }
  return reason;
}

export async function submitUserReportFromWeb(guildId: string, formData: FormData): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/report/guild/${guildId}`);
  }

  const [guilds, server] = await Promise.all([
    fetchDiscordGuilds(token.accessToken),
    createSetupDataAdapter().getServer(guildId),
  ]);
  const guild = guilds.find((item) => item.id === guildId);

  const targetUserId = readTargetUserId(formData);
  const reason = readReason(formData);
  const context = createWebActionContext({ guildId, userId: session.userId, source: 'web_report' });
  const command = {
    kind: 'submit_user_report' as const,
    targetUserId,
    targetLabel: targetUserId,
    reason,
  };
  const status = await submitReportRequest({
    context,
    command,
    access: {
      member: !!guild,
      active: server?.is_active === true,
      reasonRequired: server?.settings.user_report_reason_required === true,
    },
    confirmations: createWebReportConfirmationPort(context, command, formData),
    openIntake: () => loadReporterOpenIntake(context),
  });

  if (status !== 'queued' && status !== 'processing' && status !== 'completed') {
    throw new Error('Report could not be queued. Refresh and try again.');
  }

  revalidatePath('/report');
  revalidatePath(`/report/guild/${guildId}`);
  redirect(`/report/guild/${guildId}?queued=1&target=${encodeURIComponent(targetUserId)}`);
}

export async function startGuidedReportIntakeFromWeb(
  guildId: string,
  _formData: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/report/guild/${guildId}`);
  }

  const [guilds, server] = await Promise.all([
    fetchDiscordGuilds(token.accessToken),
    createSetupDataAdapter().getServer(guildId),
  ]);
  const guild = guilds.find((item) => item.id === guildId);

  if (!guild || !server?.is_active)
    throw new Error('This report destination is not available to the signed-in Discord account.');
  const channelId = server.settings.report_instructions_channel_id;
  if (!channelId) {
    throw new Error('This server does not have a report instructions channel configured.');
  }

  const context = createWebActionContext({ guildId, userId: session.userId, source: 'web_report' });
  const command = { kind: 'start_report_intake' as const, channelId };
  const status = await submitReportRequest({
    context,
    command,
    access: { member: !!guild, active: server?.is_active === true, reasonRequired: false },
    confirmations: { verify: async () => false },
    openIntake: () => loadReporterOpenIntake(context),
  });

  if (status !== 'queued' && status !== 'processing' && status !== 'completed') {
    throw new Error('Guided report could not be queued. Refresh and try again.');
  }

  revalidatePath('/report');
  revalidatePath(`/report/guild/${guildId}`);
  redirect(`/report/guild/${guildId}?guided=queued`);
}

export async function closeOpenReportIntakeFromWeb(
  guildId: string,
  formData: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/report/guild/${guildId}`);
  }

  const [guilds, server] = await Promise.all([
    fetchDiscordGuilds(token.accessToken),
    createSetupDataAdapter().getServer(guildId),
  ]);
  const guild = guilds.find((item) => item.id === guildId);

  const reportIntakeId = readTrimmedFormString(formData, 'reportIntakeId');
  if (!reportIntakeId || !UUID_PATTERN.test(reportIntakeId)) {
    throw new Error('This report intake is no longer available.');
  }
  const context = createWebActionContext({ guildId, userId: session.userId, source: 'web_report' });
  const command = { kind: 'close_report_intake' as const, intakeId: reportIntakeId };
  const status = await submitReportRequest({
    context,
    command,
    access: { member: !!guild, active: server?.is_active === true, reasonRequired: false },
    confirmations: createWebReportConfirmationPort(context, command, formData),
    openIntake: () => loadReporterOpenIntake(context),
  });

  if (status !== 'queued' && status !== 'processing' && status !== 'completed') {
    throw new Error('Report intake close could not be queued. Refresh and try again.');
  }

  revalidatePath('/report');
  revalidatePath(`/report/guild/${guildId}`);
  redirect(`/report/guild/${guildId}?closed=queued`);
}
