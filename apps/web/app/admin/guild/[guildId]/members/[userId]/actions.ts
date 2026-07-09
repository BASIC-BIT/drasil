'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { MemberProfile } from '@drasil/contracts';
import {
  isDetectionAccountingWebAction,
  queueDetectionAccountingActionRequest,
  type DetectionAccountingWebAction,
} from '@/lib/detectionAccountingActionQueue';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { queueMemberManualFlagActionRequest } from '@/lib/memberManualFlagActionQueue';
import { queueMemberOpenCaseActionRequest } from '@/lib/memberOpenCaseActionQueue';
import { createMemberProfileDataAdapter } from '@/lib/memberProfileDataAdapter';
import { queueObservedAlertUndoActionRequest } from '@/lib/observedAlertActionQueue';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

function isUndoableObservedAction(action: string | null): boolean {
  return action === 'dismiss' || action === 'false_positive';
}

function readFormString(formData: FormData | undefined, key: string): string | null {
  const value = formData?.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function assertCanOpenAdminCase(guild: {
  readonly owner: boolean;
  readonly permissions: string;
}): void {
  if (guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.ModerateMembers)) {
    throw new Error('You need Moderate Members permission to open a case for this member.');
  }
}

function assertCanManuallyFlag(guild: {
  readonly owner: boolean;
  readonly permissions: string;
}): void {
  if (guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)) {
    throw new Error('You need Administrator permission to flag this member.');
  }
}

function readRequestId(formData: FormData | undefined): string {
  const requestId = readFormString(formData, 'requestId');
  return requestId && requestId.length <= 100 ? requestId : randomUUID();
}

function resolveSourceMessageInput(
  profile: MemberProfile | null,
  formData: FormData | undefined
): {
  readonly sourceChannelId: string;
  readonly sourceDetectionEventId: string;
  readonly sourceMessageId: string;
} | null {
  const sourceDetectionEventId = readFormString(formData, 'sourceDetectionEventId');
  const sourceChannelId = readFormString(formData, 'sourceChannelId');
  const sourceMessageId = readFormString(formData, 'sourceMessageId');
  if (!sourceDetectionEventId && !sourceChannelId && !sourceMessageId) {
    return null;
  }
  if (!sourceDetectionEventId || !sourceChannelId || !sourceMessageId) {
    throw new Error('Source message action is missing message context.');
  }

  const detection = profile?.detections.find((item) => item.id === sourceDetectionEventId) ?? null;
  if (
    !detection ||
    detection.sourceChannelId !== sourceChannelId ||
    detection.sourceMessageId !== sourceMessageId
  ) {
    throw new Error('Source message context is no longer available for this member.');
  }

  return {
    sourceChannelId,
    sourceDetectionEventId,
    sourceMessageId,
  };
}

export async function queueObservedDetectionUndoAction(
  guildId: string,
  targetUserId: string,
  detectionEventId: string
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/members/${targetUserId}`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);

  const profile = await createMemberProfileDataAdapter().getMemberProfile(guildId, targetUserId);
  const detection = profile?.detections.find((item) => item.id === detectionEventId) ?? null;
  if (!detection || !isUndoableObservedAction(detection.observedAction)) {
    throw new Error('Observed detection action is no longer available to undo.');
  }

  const status = await queueObservedAlertUndoActionRequest({
    actorId: session.userId,
    actorSurface: 'web',
    detectionEventId,
    guildId,
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/members/${targetUserId}`);
  revalidatePath(`/admin/guild/${guildId}/reports`);
  revalidatePath(`/admin/guild/${guildId}/history`);

  if (status === 'failed') {
    throw new Error(
      'Observed alert undo could not be queued. Refresh the member profile and try again.'
    );
  }
}

export async function queueMemberOpenCaseAction(
  guildId: string,
  targetUserId: string,
  formData?: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/members/${targetUserId}`);
  }

  if (formData?.get('confirmAction') !== 'on') {
    throw new Error('Confirm the open case action before queueing it.');
  }
  if (session.userId === targetUserId) {
    throw new Error('You cannot open a moderation case for yourself.');
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertCanOpenAdminCase(guild);

  const profile = await createMemberProfileDataAdapter().getMemberProfile(guildId, targetUserId);
  if (!profile || profile.presenceState !== 'in_server') {
    throw new Error('This member is no longer available for a new case.');
  }

  const server = await createSetupDataAdapter().getServer(guildId);
  const reason = readFormString(formData, 'reason');
  if (server?.settings.admin_case_open_requires_reason === true && !reason) {
    throw new Error('Open case reason is required for this server.');
  }
  const sourceMessageInput = resolveSourceMessageInput(profile, formData);

  const status = await queueMemberOpenCaseActionRequest({
    actorId: session.userId,
    actorSurface: 'web',
    guildId,
    reason,
    requestId: readRequestId(formData),
    sourceChannelId: sourceMessageInput?.sourceChannelId,
    sourceDetectionEventId: sourceMessageInput?.sourceDetectionEventId,
    sourceMessageId: sourceMessageInput?.sourceMessageId,
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/members/${targetUserId}`);
  revalidatePath(`/admin/guild/${guildId}/history`);

  if (status === 'failed') {
    throw new Error(
      'Open case action could not be queued. Refresh the member profile and try again.'
    );
  }
}

export async function queueMemberManualFlagAction(
  guildId: string,
  targetUserId: string,
  formData?: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/members/${targetUserId}`);
  }

  if (formData?.get('confirmAction') !== 'on') {
    throw new Error('Confirm the flag action before queueing it.');
  }
  if (session.userId === targetUserId) {
    throw new Error('You cannot manually flag yourself.');
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertCanManuallyFlag(guild);

  const profile = await createMemberProfileDataAdapter().getMemberProfile(guildId, targetUserId);
  if (!profile || profile.presenceState !== 'in_server') {
    throw new Error('This member is no longer available for manual flagging.');
  }

  const status = await queueMemberManualFlagActionRequest({
    actorId: session.userId,
    actorSurface: 'web',
    guildId,
    reason: readFormString(formData, 'reason'),
    requestId: readRequestId(formData),
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/members/${targetUserId}`);
  revalidatePath(`/admin/guild/${guildId}/history`);

  if (status === 'failed') {
    throw new Error(
      'Manual flag action could not be queued. Refresh the member profile and try again.'
    );
  }
}

export async function queueDetectionAccountingAction(
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: DetectionAccountingWebAction,
  formData?: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/members/${targetUserId}`);
  }

  if (!isDetectionAccountingWebAction(action)) {
    throw new Error(`Unsupported detection accounting action: ${action}`);
  }
  if (formData?.get('confirmAction') !== 'on') {
    throw new Error('Confirm the detection accounting action before queueing it.');
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);

  const profile = await createMemberProfileDataAdapter().getMemberProfile(guildId, targetUserId);
  const detection = profile?.detections.find((item) => item.id === detectionEventId) ?? null;
  if (!detection) {
    throw new Error('Detection is no longer available for this member.');
  }
  if (action === 'ignore_detection' && detection.accounting.excluded) {
    throw new Error('Detection is already ignored for future accounting.');
  }
  if (action === 'restore_detection' && !detection.accounting.excluded) {
    throw new Error('Detection already counts toward future accounting.');
  }

  const status = await queueDetectionAccountingActionRequest({
    action,
    actorId: session.userId,
    actorSurface: 'web',
    detectionEventId,
    guildId,
    reason: readFormString(formData, 'reason'),
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/members/${targetUserId}`);
  revalidatePath(`/admin/guild/${guildId}/history`);

  if (status === 'failed') {
    throw new Error(
      'Detection accounting action could not be queued. Refresh the member profile and try again.'
    );
  }
}
