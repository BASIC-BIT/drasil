'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  guildSetupUpdateSchema,
  MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES,
  MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS,
  type DetectionResponseMode,
} from '@drasil/contracts';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { createSetupDashboardService } from '@/lib/setupDashboardService';

function readOptionalFormString(formData: FormData, key: string): string | null | undefined {
  const value = formData.get(key);
  if (value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readMode(formData: FormData, key: string): DetectionResponseMode | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0
    ? (value as DetectionResponseMode)
    : undefined;
}

function readNullableMode(
  formData: FormData,
  key: string
): DetectionResponseMode | null | undefined {
  const value = formData.get(key);
  if (value === null) {
    return undefined;
  }
  return typeof value === 'string' && value.length > 0 ? (value as DetectionResponseMode) : null;
}

function readOptionalFormValue(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readWatchlistCustomTerms(formData: FormData): string[] {
  const value = formData.get('messageDeletionWatchlistCustomTerms');
  if (typeof value !== 'string') {
    return [];
  }

  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => {
      if (!line || seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    })
    .slice(0, MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS);
}

function readDisabledDefaultWatchlistIds(formData: FormData): string[] {
  const enabledIds = new Set(formData.getAll('messageDeletionDefaultWatchlistIds'));
  return MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES.map((entry) => entry.id).filter(
    (id) => !enabledIds.has(id)
  );
}

export async function saveGuildSetup(guildId: string, formData: FormData): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const service = createSetupDashboardService();
  await service.assertCanManageGuild(guildId, token.accessToken);
  const update = guildSetupUpdateSchema.parse({
    guildId,
    updatedBy: session.userId,
    caseRoleId: readOptionalFormString(formData, 'caseRoleId'),
    adminChannelId: readOptionalFormString(formData, 'adminChannelId'),
    verificationChannelId: readOptionalFormString(formData, 'verificationChannelId'),
    adminNotificationRoleId: readOptionalFormString(formData, 'adminNotificationRoleId'),
    observedNotificationChannelId: readOptionalFormString(
      formData,
      'observedNotificationChannelId'
    ),
    reportInstructionsChannelId: readOptionalFormString(formData, 'reportInstructionsChannelId'),
    detectionResponseMode: readMode(formData, 'detectionResponseMode'),
    messageDetectionResponseMode: readNullableMode(formData, 'messageDetectionResponseMode'),
    joinDetectionResponseMode: readNullableMode(formData, 'joinDetectionResponseMode'),
    userReportReasonRequired: formData.get('userReportReasonRequired') === 'on',
    userReportExternalResponseMode: readOptionalFormValue(
      formData,
      'userReportExternalResponseMode'
    ),
    analyticsConsentLevel: readOptionalFormValue(formData, 'analyticsConsentLevel'),
    reportAiTriageEnabled: formData.get('reportAiTriageEnabled') === 'on',
    reportAiMaxAction: readOptionalFormValue(formData, 'reportAiMaxAction'),
    messageDeletionEnabled: formData.get('messageDeletionEnabled') === 'on',
    messageDeletionSourceMessageEnabled:
      formData.get('messageDeletionSourceMessageEnabled') === 'on',
    messageDeletionWatchlistEnabled: formData.get('messageDeletionWatchlistEnabled') === 'on',
    messageDeletionWatchlistDisabledDefaultIds: readDisabledDefaultWatchlistIds(formData),
    messageDeletionWatchlistCustomTerms: readWatchlistCustomTerms(formData),
  });

  await service.updateGuildSetup(update);
  revalidatePath(`/admin/guild/${guildId}/setup`);
}
