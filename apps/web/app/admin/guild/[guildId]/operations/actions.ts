'use server';

import { createWebActionContext } from '@/lib/application/context';
import { queuedOperationCommandSchema, type QueuedOperationCommand } from '@drasil/application';
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

function assertChecked(formData: FormData | undefined, key: string, message: string): void {
  if (formData?.get(key) !== 'on') {
    throw new Error(message);
  }
}

function readOperationCommand(
  action: ModerationQueueOperationAction,
  formData: FormData | undefined
): Exclude<QueuedOperationCommand, { kind: 'audit_integrity' }> {
  switch (action) {
    case 'clear_moderation_queue':
      assertChecked(formData, 'confirmClearQueue', 'Confirm queue clearing before queueing it.');
      return { kind: action };
    case 'close_resolved_case_threads': {
      const execute = formData?.get('execute') === 'true';
      if (execute)
        assertChecked(
          formData,
          'confirmCloseResolvedThreads',
          'Confirm resolved thread closure before queueing it.'
        );
      return {
        kind: action,
        intent: 'administrator_operation',
        execute,
        days: readBoundedInteger(formData, 'days', 30, 1, 365),
        limit: readBoundedInteger(formData, 'limit', 100, 1, 500),
        userId: null,
      };
    }
    case 'apply_case_role_lockdown':
      assertChecked(
        formData,
        'confirmApplyLockdown',
        'Confirm case-role lockdown apply before queueing it.'
      );
      return {
        kind: action,
        unsyncAllowedChannels: formData?.get('unsyncAllowedChannels') === 'on',
      };
    case 'intake_role_members': {
      const roleId = readTrimmedString(formData, 'roleId');
      if (!roleId) throw new Error('Choose a role before queueing role intake.');
      const execute = formData?.get('execute') === 'true';
      if (execute)
        assertChecked(
          formData,
          'confirmRoleIntake',
          'Confirm role intake execution before queueing it.'
        );
      return {
        kind: action,
        execute,
        roleId,
        limit: readBoundedInteger(formData, 'limit', 250, 1, 250),
        reason: readTrimmedString(formData, 'reason'),
      };
    }
    case 'audit_case_role_lockdown':
    case 'sync_moderation_queue':
      return { kind: action };
    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
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

  const command = readOperationCommand(action, formData);
  queuedOperationCommandSchema.parse(command);

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertAdministrator(guild);

  const { status } = await queueModerationQueueOperation({
    context: createWebActionContext({ guildId, userId: session.userId }),
    command,
  });

  revalidatePath(`/admin/guild/${guildId}/operations`);
  revalidatePath(`/admin/guild/${guildId}/inbox`);

  if (status === 'queued' || status === 'processing' || status === 'completed') {
    return;
  }

  throw new Error('Moderation queue operation could not be queued. Refresh and try again.');
}
