'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  queueModerationQueueOperation,
  type ModerationQueueOperationAction,
} from '@/lib/moderationQueueOperationActionQueue';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

const queueOperationActions = new Set<ModerationQueueOperationAction>([
  'sync_moderation_queue',
  'clear_moderation_queue',
  'close_resolved_case_threads',
  'audit_case_role_lockdown',
  'apply_case_role_lockdown',
  'intake_role_members',
]);

function readBoundedInteger(
  formData: FormData | undefined,
  key: string,
  defaultValue: number,
  min: number,
  max: number
): number {
  const value = formData?.get(key);
  if (typeof value !== 'string' || value.trim() === '') {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(parsed, max));
}

function readTrimmedString(formData: FormData | undefined, key: string): string | null {
  const value = formData?.get(key);
  if (typeof value !== 'string') {
    return null;
  }

  return value.trim() || null;
}

function assertAdministrator(guild: { readonly owner: boolean; readonly permissions: string }) {
  if (guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)) {
    throw new Error('You need Administrator permission to run moderation queue operations.');
  }
}

export async function queueModerationQueueOperationAction(
  guildId: string,
  action: ModerationQueueOperationAction,
  formData?: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/operations`);
  }

  if (!queueOperationActions.has(action)) {
    throw new Error(`Unsupported moderation queue operation: ${action}`);
  }

  if (action === 'clear_moderation_queue' && formData?.get('confirmClearQueue') !== 'on') {
    throw new Error('Confirm queue clearing before queueing it.');
  }

  const executeResolvedThreadSweep =
    action === 'close_resolved_case_threads' && formData?.get('execute') === 'true';
  if (
    action === 'close_resolved_case_threads' &&
    executeResolvedThreadSweep &&
    formData?.get('confirmCloseResolvedThreads') !== 'on'
  ) {
    throw new Error('Confirm resolved thread closure before queueing it.');
  }
  if (action === 'apply_case_role_lockdown' && formData?.get('confirmApplyLockdown') !== 'on') {
    throw new Error('Confirm case-role lockdown apply before queueing it.');
  }
  const executeRoleIntake = action === 'intake_role_members' && formData?.get('execute') === 'true';
  const roleIntakeRoleId =
    action === 'intake_role_members' ? readTrimmedString(formData, 'roleId') : null;
  if (action === 'intake_role_members' && !roleIntakeRoleId) {
    throw new Error('Choose a role before queueing role intake.');
  }
  if (
    action === 'intake_role_members' &&
    executeRoleIntake &&
    formData?.get('confirmRoleIntake') !== 'on'
  ) {
    throw new Error('Confirm role intake execution before queueing it.');
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertAdministrator(guild);

  const status = await queueModerationQueueOperation({
    action,
    actorId: session.userId,
    days:
      action === 'close_resolved_case_threads'
        ? readBoundedInteger(formData, 'days', 30, 1, 365)
        : null,
    execute: action === 'close_resolved_case_threads' ? executeResolvedThreadSweep : undefined,
    guildId,
    limit:
      action === 'close_resolved_case_threads'
        ? readBoundedInteger(formData, 'limit', 100, 1, 500)
        : action === 'intake_role_members'
          ? readBoundedInteger(formData, 'limit', 250, 1, 250)
          : null,
    reason: action === 'intake_role_members' ? readTrimmedString(formData, 'reason') : null,
    roleId: roleIntakeRoleId,
    unsyncAllowedChannels:
      action === 'apply_case_role_lockdown'
        ? formData?.get('unsyncAllowedChannels') === 'on'
        : null,
  });

  revalidatePath(`/admin/guild/${guildId}/operations`);
  revalidatePath(`/admin/guild/${guildId}/inbox`);

  if (status === 'queued' || status === 'processing' || status === 'completed') {
    return;
  }

  throw new Error('Moderation queue operation could not be queued. Refresh and try again.');
}
