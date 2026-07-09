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

interface QueueOperationOptions {
  readonly days: number | null;
  readonly execute?: boolean;
  readonly limit: number | null;
  readonly reason: string | null;
  readonly roleId: string | null;
  readonly unsyncAllowedChannels: boolean | null;
}

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

function assertChecked(formData: FormData | undefined, key: string, message: string): void {
  if (formData?.get(key) !== 'on') {
    throw new Error(message);
  }
}

function emptyOperationOptions(): QueueOperationOptions {
  return {
    days: null,
    limit: null,
    reason: null,
    roleId: null,
    unsyncAllowedChannels: null,
  };
}

function readResolvedThreadSweepOptions(formData: FormData | undefined): QueueOperationOptions {
  const execute = formData?.get('execute') === 'true';
  if (execute) {
    assertChecked(
      formData,
      'confirmCloseResolvedThreads',
      'Confirm resolved thread closure before queueing it.'
    );
  }

  return {
    ...emptyOperationOptions(),
    days: readBoundedInteger(formData, 'days', 30, 1, 365),
    execute,
    limit: readBoundedInteger(formData, 'limit', 100, 1, 500),
  };
}

function readRoleIntakeOptions(formData: FormData | undefined): QueueOperationOptions {
  const execute = formData?.get('execute') === 'true';
  const roleId = readTrimmedString(formData, 'roleId');
  if (!roleId) {
    throw new Error('Choose a role before queueing role intake.');
  }
  if (execute) {
    assertChecked(
      formData,
      'confirmRoleIntake',
      'Confirm role intake execution before queueing it.'
    );
  }

  return {
    ...emptyOperationOptions(),
    execute,
    limit: readBoundedInteger(formData, 'limit', 250, 1, 250),
    reason: readTrimmedString(formData, 'reason'),
    roleId,
  };
}

function readOperationOptions(
  action: ModerationQueueOperationAction,
  formData: FormData | undefined
): QueueOperationOptions {
  if (action === 'clear_moderation_queue') {
    assertChecked(formData, 'confirmClearQueue', 'Confirm queue clearing before queueing it.');
  }
  if (action === 'close_resolved_case_threads') {
    return readResolvedThreadSweepOptions(formData);
  }
  if (action === 'apply_case_role_lockdown') {
    assertChecked(
      formData,
      'confirmApplyLockdown',
      'Confirm case-role lockdown apply before queueing it.'
    );
    return {
      ...emptyOperationOptions(),
      unsyncAllowedChannels: formData?.get('unsyncAllowedChannels') === 'on',
    };
  }
  if (action === 'intake_role_members') {
    return readRoleIntakeOptions(formData);
  }

  return emptyOperationOptions();
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

  const options = readOperationOptions(action, formData);

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertAdministrator(guild);

  const status = await queueModerationQueueOperation({
    action,
    actorId: session.userId,
    days: options.days,
    execute: options.execute,
    guildId,
    limit: options.limit,
    reason: options.reason,
    roleId: options.roleId,
    unsyncAllowedChannels: options.unsyncAllowedChannels,
  });

  revalidatePath(`/admin/guild/${guildId}/operations`);
  revalidatePath(`/admin/guild/${guildId}/inbox`);

  if (status === 'queued' || status === 'processing' || status === 'completed') {
    return;
  }

  throw new Error('Moderation queue operation could not be queued. Refresh and try again.');
}
