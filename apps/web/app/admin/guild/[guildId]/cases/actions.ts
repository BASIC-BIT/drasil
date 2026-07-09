'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { caseActionSchema, type CaseAction } from '@drasil/contracts';
import { createActiveCaseDataAdapter, type WebCaseAction } from '@/lib/activeCaseDataAdapter';
import { fetchGuildResources } from '@/lib/discordApi';
import {
  DISCORD_PERMISSIONS,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from '@/lib/discordPermissions';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

const queuedCaseActions = new Set<CaseAction>([
  'verify_user',
  'kick_user',
  'ban_user',
  'ban_by_id',
  'close_no_action',
  'repair_thread',
  'create_thread',
  'reopen_case',
  'refresh_notification',
  'sync_existing_ban',
]);

const queueCaseActionErrorMessages = {
  already_handled: 'Case action already completed. Refresh the case queue and try again.',
  case_not_found: 'Case is no longer available. Refresh the case queue and try again.',
  not_allowed: 'Case action is not available for this case state.',
} as const;

type DestructiveCaseAction = Extract<WebCaseAction, 'kick_user' | 'ban_user' | 'ban_by_id'>;

interface DestructiveActionOptions {
  readonly reason: string | null;
}

function isDestructiveCaseAction(action: WebCaseAction): action is DestructiveCaseAction {
  return action === 'kick_user' || action === 'ban_user' || action === 'ban_by_id';
}

function destructivePermission(action: WebCaseAction): bigint | null {
  if (action === 'kick_user') {
    return DISCORD_PERMISSIONS.KickMembers;
  }
  if (action === 'ban_user' || action === 'ban_by_id' || action === 'sync_existing_ban') {
    return DISCORD_PERMISSIONS.BanMembers;
  }
  return null;
}

function assertActorPermission(
  action: WebCaseAction,
  guild: { readonly owner: boolean; readonly permissions: string }
): void {
  if (action === 'refresh_notification') {
    if (guild.owner) {
      return;
    }
    if (!hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)) {
      throw new Error('You need Administrator permission to refresh case notifications.');
    }
    return;
  }

  const requiredPermission = destructivePermission(action);
  if (!requiredPermission || guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), requiredPermission)) {
    throw new Error(
      action === 'kick_user'
        ? 'You need Kick Members permission to kick a case user.'
        : 'You need Ban Members permission to queue this case action.'
    );
  }
}

function readFormString(formData: FormData | undefined, key: string): string | null {
  const value = formData?.get(key);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function assertCanQueueCaseAction(
  action: WebCaseAction,
  guild: { readonly id: string; readonly owner: boolean; readonly permissions: string },
  formData: FormData | undefined
): Promise<DestructiveActionOptions> {
  assertActorPermission(action, guild);

  if (!isDestructiveCaseAction(action)) {
    return { reason: null };
  }

  if (formData?.get('confirmAction') !== 'on') {
    throw new Error('Confirm the moderation action before queueing it.');
  }

  const setupAdapter = createSetupDataAdapter();
  const server = await setupAdapter.getServer(guild.id);
  const settings = server?.settings ?? {};
  const isBanAction = action === 'ban_user' || action === 'ban_by_id';
  const enabled = isBanAction
    ? settings.moderator_ban_action_enabled !== false
    : settings.moderator_kick_action_enabled !== false;
  if (!enabled) {
    throw new Error(
      isBanAction
        ? 'Moderator ban actions are disabled for this server.'
        : 'Moderator kick actions are disabled for this server.'
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
  const requiredBotPermission = destructivePermission(action);
  if (requiredBotPermission && !hasPermission(botPermissions, requiredBotPermission)) {
    throw new Error(
      isBanAction
        ? 'Drasil is missing Ban Members permission.'
        : 'Drasil is missing Kick Members permission.'
    );
  }

  return { reason };
}

export async function queueCaseAction(
  guildId: string,
  caseId: string,
  action: WebCaseAction,
  formData?: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/cases/${caseId}`);
  }

  const parsedAction = caseActionSchema.parse(action);
  if (!queuedCaseActions.has(parsedAction)) {
    throw new Error(`Unsupported case action: ${parsedAction}`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  const options = await assertCanQueueCaseAction(parsedAction as WebCaseAction, guild, formData);
  const result = await createActiveCaseDataAdapter().queueCaseAction({
    action: parsedAction as WebCaseAction,
    adminId: session.userId,
    caseId,
    guildId,
    reason: options.reason,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/cases/${caseId}`);
  revalidatePath(`/admin/guild/${guildId}/history`);

  if (result.status === 'queued') {
    return;
  }

  throw new Error(
    queueCaseActionErrorMessages[result.status] ?? `Unsupported case action: ${parsedAction}`
  );
}
