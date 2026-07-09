'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { fetchDiscordGuilds } from '@/lib/discordApi';
import {
  queueGuidedReportIntakeRequest,
  queueReportIntakeCloseRequest,
  queueUserReportSubmissionRequest,
} from '@/lib/userReportActionQueue';
import { createReportIntakePortalDataAdapter } from '@/lib/reportIntakePortalDataAdapter';
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
  if (!guild || !server?.is_active) {
    throw new Error('This report destination is not available to the signed-in Discord account.');
  }

  const targetUserId = readTargetUserId(formData);
  if (targetUserId === session.userId) {
    throw new Error('You cannot report yourself.');
  }

  const reason = readReason(formData);
  if (server.settings.user_report_reason_required === true && !reason) {
    throw new Error('This server requires a report reason.');
  }
  if (formData.get('confirmReport') !== 'on') {
    throw new Error('Confirm the report before submitting it.');
  }

  const status = await queueUserReportSubmissionRequest({
    actorId: session.userId,
    guildId,
    reason,
    targetLabel: targetUserId,
    targetUserId,
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
  if (!guild || !server?.is_active) {
    throw new Error('This report destination is not available to the signed-in Discord account.');
  }

  const channelId = server.settings.report_instructions_channel_id;
  if (!channelId) {
    throw new Error('This server does not have a report instructions channel configured.');
  }

  const status = await queueGuidedReportIntakeRequest({
    actorId: session.userId,
    channelId,
    guildId,
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
  if (!guild || !server?.is_active) {
    throw new Error('This report destination is not available to the signed-in Discord account.');
  }

  const reportIntakeId = readTrimmedFormString(formData, 'reportIntakeId');
  if (!reportIntakeId || !UUID_PATTERN.test(reportIntakeId)) {
    throw new Error('This report intake is no longer available.');
  }
  if (formData.get('confirmCloseIntake') !== 'on') {
    throw new Error('Confirm the report intake close before submitting it.');
  }

  const openIntake = await createReportIntakePortalDataAdapter().getOpenIntakeForReporter({
    guildId,
    reporterId: session.userId,
  });
  if (!openIntake || openIntake.id !== reportIntakeId) {
    throw new Error('This report intake is no longer available.');
  }

  const status = await queueReportIntakeCloseRequest({
    actorId: session.userId,
    guildId,
    reportIntakeId,
  });

  if (status !== 'queued' && status !== 'processing' && status !== 'completed') {
    throw new Error('Report intake close could not be queued. Refresh and try again.');
  }

  revalidatePath('/report');
  revalidatePath(`/report/guild/${guildId}`);
  redirect(`/report/guild/${guildId}?closed=queued`);
}
