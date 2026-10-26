'use server';

import { createWebAuthority } from '@/lib/application/adapters/authority';
import { createWebActionContext } from '@/lib/application/context';
import { createModerationAttentionDataAdapter } from '@/lib/moderationAttentionDataAdapter';
import { createModerationWorkspaceDataAdapter } from '@/lib/moderationWorkspaceDataAdapter';
import type { WorkspaceActions } from '@/lib/workspaceActionTypes';
import { assertWorkspaceConfirmation } from '@/lib/workspaceConfirmation';
import type { AttentionOutcome } from '@drasil/application';

import { fetchGuildResources } from '@/lib/discordApi';
import {
  DISCORD_PERMISSIONS,
  computeGuildPermissions,
  hasPermission,
  parsePermissions,
} from '@/lib/discordPermissions';
import { failedInboxActionState } from '@/lib/inboxActionState';
import type { ModerationActionRequestReceipt } from '@/lib/moderationActionRequestQueue';
import {
  isObservedAlertWebAction,
  queueObservedAlertActionRequest,
  type ObservedAlertWebAction,
} from '@/lib/observedAlertActionQueue';
import { createQueueAttentionActionAdapter } from '@/lib/queueAttentionActionAdapter';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { moderationInboxActionSchema, type ModerationInboxAction } from '@drasil/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

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

async function performAcknowledgeQueueAttentionItem(
  guildId: string,
  queueItemId: string,
  workspaceForm: FormData
): Promise<AttentionOutcome> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/inbox`);
  }

  const setupService = createSetupDashboardService();
  await setupService.assertCanManageGuild(guildId, token.accessToken);
  {
    const detail = await createModerationAttentionDataAdapter().getAttentionDetail({
      guildId,
      queueItemId,
    });
    if (
      !detail ||
      detail.item.guildId !== guildId ||
      detail.item.queueItemId !== queueItemId ||
      !detail.item.allowedActions.includes('acknowledge')
    )
      throw new Error('Reply is no longer available to acknowledge. Refresh the record.');
    assertWorkspaceConfirmation(workspaceForm, {
      recordId: queueItemId,
      targetUserId: detail.item.subject.userId,
    });
  }
  const result = await createQueueAttentionActionAdapter().acknowledgeAttentionItem({
    guildId,
    queueItemId,
    actor: { id: session.userId, surface: 'web' },
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  return result;
}

async function performQueueObservedAlertAction(
  guildId: string,
  targetUserId: string | null,
  detectionEventId: string,
  action: ModerationInboxAction,
  formData: FormData
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
  {
    const actor = await createWebAuthority().loadFresh(guildId, session.userId);
    if (!actor) throw new Error('Moderator is no longer present in this server.');
    const detail = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
      guildId,
      itemId: `detection:${detectionEventId}`,
    });
    if (
      !detail ||
      detail.kind !== 'observed_alert' ||
      detail.item.guildId !== guildId ||
      detail.item.sourceId !== detectionEventId ||
      !detail.policy.allowedActions.includes(parsedAction) ||
      !detail.item.subject.userId
    )
      throw new Error('Observed alert action is no longer available. Refresh the record.');
    targetUserId = detail.item.subject.userId;
    assertWorkspaceConfirmation(formData ?? new FormData(), {
      recordId: detectionEventId,
      targetUserId,
    });
  }
  if (!targetUserId) throw new Error('Observed alert has no current member target.');
  const options = await assertCanQueueObservedAlertAction(parsedAction, guild, formData);
  const receipt = await queueObservedAlertActionRequest({
    action: parsedAction,
    context: createWebActionContext({
      guildId,
      userId: session.userId,
      requestId: detectionEventId,
    }),
    detectionEventId,
    reason: options.reason,
    targetUserId,
  });

  revalidatePath(`/admin/guild/${guildId}/inbox`);
  revalidatePath(`/admin/guild/${guildId}/cases`);
  revalidatePath(`/admin/guild/${guildId}/reports`);

  return receipt;
}

export async function submitWorkspaceObservedAction(
  input: Parameters<WorkspaceActions['observedAction']>[0],
  formData: FormData
): ReturnType<WorkspaceActions['observedAction']> {
  try {
    const receipt = await performQueueObservedAlertAction(
      input.guildId,
      null,
      input.detectionId,
      input.action,
      formData
    );
    return { kind: 'request', receipt };
  } catch (error) {
    return {
      kind: 'failed',
      message: failedInboxActionState(error).message ?? 'Action response unavailable.',
    };
  }
}
export async function submitWorkspaceAttentionAction(
  input: Parameters<WorkspaceActions['attentionAction']>[0],
  formData: FormData
): ReturnType<WorkspaceActions['attentionAction']> {
  try {
    return {
      kind: 'attention',
      result: await performAcknowledgeQueueAttentionItem(
        input.guildId,
        input.queueItemId,
        formData
      ),
    };
  } catch (error) {
    return {
      kind: 'failed',
      message: failedInboxActionState(error).message ?? 'Action response unavailable.',
    };
  }
}
