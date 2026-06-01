'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { guildSetupUpdateSchema, type DetectionResponseMode } from '@drasil/contracts';
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

function readRoleIds(formData: FormData): string[] | undefined {
  const values = formData.getAll('caseResponderRoleIds');
  if (values.length === 0) {
    return undefined;
  }
  return values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

export async function saveGuildSetup(guildId: string, formData: FormData): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const service = createSetupDashboardService();
  await service.getDashboard(guildId, token.accessToken);
  const update = guildSetupUpdateSchema.parse({
    guildId,
    restrictedRoleId: readOptionalFormString(formData, 'restrictedRoleId'),
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
    caseResponderRoleIds: readRoleIds(formData),
    caseResponderRoutingMode: readOptionalFormValue(formData, 'caseResponderRoutingMode'),
  });

  await service.updateGuildSetup(update);
  revalidatePath(`/admin/guild/${guildId}/setup`);
}
