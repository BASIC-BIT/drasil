'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { moderationInboxActionSchema, type ModerationInboxAction } from '@drasil/contracts';
import { fetchGuildResources } from '@/lib/discordApi';
import {
  DISCORD_PERMISSIONS,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from '@/lib/discordPermissions';
import {
  isObservedAlertWebAction,
  queueObservedAlertActionRequest,
  type ObservedAlertWebAction,
} from '@/lib/observedAlertActionQueue';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { createQueueAttentionActionAdapter } from '@/lib/queueAttentionActionAdapter';
import {
  completedInboxActionState,
  failedInboxActionState,
  queuedInboxActionState,
  type InboxActionState,
} from '@/lib/inboxActionState';
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';

type DestructiveObservedAlertAction = Extract<ObservedAlertWebAction, 'kick_user' | 'ban_user'>;

interface ObservedAlertActionOptions {
  readonly reason: string | null;
}

function isDestructiveObservedAlertAction(
  action: ObservedAlertWebAction
): action is DestructiveObservedAlertAction {
  return action === 'kick_user' || action === 'ban_user';
}

function observedDestructivePermission(action: ObservedAlertWebAction): bigint | null {
  if (action === 'kick_user') {
    return DISCORD_PERMISSIONS.KickMembers;
  }
  if (action === 'ban_user') {
    return DISCORD_PERMISSIONS.BanMembers;
  }
  return null;
}

function assertObservedActorPermission(
  action: ObservedAlertWebAction,
  guild: { readonly owner: boolean; readonly permissions: string }
): void {
  const requiredPermission = observedDestructivePermission(action);
  if (!requiredPermission || guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), requiredPermission)) {
    throw new Error(
      action === 'kick_user'
        ? 'You need Kick Members permission to kick from an observed alert.'
        : 'You need Ban Members permission to ban from an observed alert.'
    );
  }
}

function readFormString(formData: FormData | undefined, key: string): string | null {
  const value = formData?.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readQueueItemIds(formData: FormData): string[] {
  const seen = new Set<string>();
  return formData
    .getAll('queueItemId')
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    })
    .slice(0, 50);
}

async function assertCanQueueObservedAlertAction(
  action: ObservedAlertWebAction,
  guild: { readonly id: string; readonly owner: boolean; readonly permissions: string },
  formData: FormData | undefined
): Promise<ObservedAlertActionOptions> {
  assertObservedActorPermission(action, guild);

  if (!isDestructiveObservedAlertAction(action)) {
    return { reason: null };
  }

  if (formData?.get('confirmAction') !== 'on') {
    throw new Error('Confirm the observed alert action before queueing it.');
  }

  const setupAdapter = createSetupDataAdapter();
  const server = await setupAdapter.getServer(guild.id);
  const settings = server?.settings ?? {};
  const isBanAction = action === 'ban_user';
  const enabled = isBanAction
    ? settings.moderator_ban_action_enabled !== false
    : settings.observed_action_kick_enabled === true;
  if (!enabled) {
    throw new Error(
      isBanAction
        ? 'Moderator ban actions are disabled for this server.'
        : 'Observed alert kick actions are disabled for this server.'
    );
  }

  const reason = readFormString(formData, 'reason');
  const requiresReason = isBanAction
    ? settings.moderator_ban_action_requires_reason === true
    : settings.moderator_kick_action_requires_reason === true;
  if (requiresReason && !reason) {
    throw new Error(isBanAction ? 'Ban reason is required.' : 'Kick reason is required.');
  }

  const resources = await fetchGuildResources(guild.id);
  const botPermissions = computeGuildPermissions({
    guildId: guild.id,
    memberRoleIds: resources.botMember.roles,
    roles: resources.roles,
  });
  const requiredBotPermission = observedDestructivePermission(action);
  if (requiredBotPermission && !hasPermission(botPermissions, requiredBotPermission)) {
    throw new Error(
      isBanAction
        ? 'Drasil is missing Ban Members permission.'
        : 'Drasil is missing Kick Members permission.'
    );
  }

  return { reason };
}

export async function acknowledgeQueueAttentionItem(
  guildId: string,
  queueItemId: string
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  await createQueueAttentionActionAdapter().acknowledgeAttentionItem({
    guildId,
    queueItemId,
    actor: { id: session.userId, surface: 'web' },
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
}

export async function acknowledgeInboxQueueAttentionItem(
  guildId: string,
  queueItemId: string,
  _previousState: InboxActionState,
  _formData: FormData
): Promise<InboxActionState> {
  try {
    await acknowledgeQueueAttentionItem(guildId, queueItemId);
    return completedInboxActionState('Reply acknowledged.');
  } catch (error) {
    return failedInboxActionState(error);
  }
}

export async function acknowledgeQueueAttentionItems(
  guildId: string,
  formData: FormData
): Promise<void> {
  const queueItemIds = readQueueItemIds(formData);
  if (queueItemIds.length === 0) {
    return;
  }

  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  const adapter = createQueueAttentionActionAdapter();
  const actor = { id: session.userId, surface: 'web' as const };

  for (const queueItemId of queueItemIds) {
    await adapter.acknowledgeAttentionItem({
      guildId,
      queueItemId,
      actor,
    });
  }

  revalidatePath(`/admin/guild/${guildId}/inbox`);
}

export async function acknowledgeInboxQueueAttentionItems(
  guildId: string,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    const queueItemCount = readQueueItemIds(formData).length;
    if (queueItemCount === 0) {
      throw new Error('Select at least one reply to acknowledge.');
    }
    await acknowledgeQueueAttentionItems(guildId, formData);
    return completedInboxActionState(
      `${queueItemCount} ${queueItemCount === 1 ? 'reply' : 'replies'} acknowledged.`
    );
  } catch (error) {
    return failedInboxActionState(error);
  }
}

async function performQueueObservedAlertAction(
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: ModerationInboxAction,
  formData?: FormData
): Promise<ModerationActionRequestReceipt> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
  }

  const parsedAction = moderationInboxActionSchema.parse(action);
  if (!isObservedAlertWebAction(parsedAction)) {
    throw new Error(`Unsupported observed alert action: ${parsedAction}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const options = await assertCanQueueObservedAlertAction(parsedAction, guild, formData);
  const receipt = await queueObservedAlertActionRequest({
    action: parsedAction,
    actorId: session.userId,
    actorSurface: 'web',
    detectionEventId,
    guildId,
    reason: options.reason,
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/reports`);

  if (receipt.status === 'failed') {
    throw new Error('Observed alert action could not be queued. Refresh the inbox and try again.');
  }

  return receipt;
}

export async function queueObservedAlertAction(
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: ModerationInboxAction,
  formData?: FormData
): Promise<void> {
  await performQueueObservedAlertAction(guildId, targetUserId, detectionEventId, action, formData);
}

export async function queueInboxObservedAlertAction(
  guildId: string,
  targetUserId: string,
  detectionEventId: string,
  action: ModerationInboxAction,
  _previousState: InboxActionState,
  formData: FormData
): Promise<InboxActionState> {
  try {
    const receipt = await performQueueObservedAlertAction(
      guildId,
      targetUserId,
      detectionEventId,
      action,
      formData
    );
    return queuedInboxActionState(receipt);
  } catch (error) {
    return failedInboxActionState(error);
  }
}
