'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  HEURISTIC_MAX_KEYWORDS,
  MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH,
  guildSetupUpdateSchema,
  MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS,
  type DetectionResponseMode,
} from '@drasil/contracts';
import { getCurrentAdminSession, getCurrentDiscordToken } from '@/lib/session';
import { assertCanUpdateAnalyticsConsent } from '@/lib/setupAuthorization';
import { DISCORD_PERMISSIONS, hasPermission, parsePermissions } from '@/lib/discordPermissions';
import {
  queueCompleteSetupVerificationRequest,
  queueReportInstructionsRepairRequest,
} from '@/lib/setupArtifactActionQueue';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
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

function readRequiredFormStringOrNull(formData: FormData, key: string): string | null | undefined {
  const value = formData.get(key);
  if (value === null || typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.replace(/\r\n/g, '\n') : null;
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

function readFormStringArray(formData: FormData, key: string): string[] {
  return formData
    .getAll(key)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readExpectedTopics(formData: FormData): string[] | undefined {
  const value = formData.get('expectedTopics');
  if (typeof value !== 'string') {
    return undefined;
  }

  const seen = new Set<string>();
  return value
    .replace(/\\n/g, '\n')
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function readHeuristicKeywords(formData: FormData): string[] | undefined {
  const value = formData.get('heuristicSuspiciousKeywords');
  if (typeof value !== 'string') {
    return undefined;
  }

  const seen = new Set<string>();
  return value
    .replace(/\\n/g, '\n')
    .split(/[\n,]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    })
    .slice(0, HEURISTIC_MAX_KEYWORDS);
}

function readOptionalIntegerFormValue(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function readOptionalNumberFormValue(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalMegabytesAsBytes(formData: FormData, key: string): number | undefined {
  const megabytes = readOptionalIntegerFormValue(formData, key);
  return megabytes === undefined ? undefined : megabytes * 1024 * 1024;
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
      if (
        !line ||
        line.length > MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH ||
        seen.has(line)
      ) {
        return false;
      }
      seen.add(line);
      return true;
    })
    .slice(0, MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS);
}

function assertAdministrator(guild: { readonly owner: boolean; readonly permissions: string }) {
  if (guild.owner) {
    return;
  }
  if (!hasPermission(parsePermissions(guild.permissions), DISCORD_PERMISSIONS.Administrator)) {
    throw new Error('You need Administrator permission to run setup repair actions.');
  }
}

function readReportInstructionsTargetChannelId(formData: FormData): string | null {
  return (
    readOptionalFormString(formData, 'reportInstructionsChannelId') ??
    readOptionalFormString(formData, 'adminChannelId') ??
    null
  );
}

export async function queueCompleteSetupVerification(
  guildId: string,
  formData: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertAdministrator(guild);

  const caseRoleId = readOptionalFormString(formData, 'caseRoleId');
  const adminChannelId = readOptionalFormString(formData, 'adminChannelId');
  if (!caseRoleId || !adminChannelId) {
    throw new Error('Choose a case role and admin alert channel before queueing core setup.');
  }

  const status = await queueCompleteSetupVerificationRequest({
    actorId: session.userId,
    adminChannelId,
    caseRoleId,
    guildId,
    reportInstructionsChannelId: readOptionalFormString(formData, 'reportInstructionsChannelId'),
    verificationChannelId: readOptionalFormString(formData, 'verificationChannelId'),
  });

  revalidatePath(`/admin/guild/${guildId}/setup`);
  revalidatePath(`/admin/guild/${guildId}/operations`);

  if (status === 'queued' || status === 'processing' || status === 'completed') {
    return;
  }

  throw new Error('Core setup repair could not be queued. Refresh and try again.');
}

export async function queueReportInstructionsRepair(
  guildId: string,
  formData: FormData
): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const setupService = createSetupDashboardService();
  const guild = await setupService.assertCanManageGuild(guildId, token.accessToken);
  assertAdministrator(guild);

  const channelId = readReportInstructionsTargetChannelId(formData);
  if (!channelId) {
    throw new Error('Choose an admin or report instructions channel before queueing repair.');
  }

  const status = await queueReportInstructionsRepairRequest({
    actorId: session.userId,
    channelId,
    guildId,
  });

  revalidatePath(`/admin/guild/${guildId}/setup`);
  revalidatePath(`/admin/guild/${guildId}/operations`);

  if (status === 'queued' || status === 'processing' || status === 'completed') {
    return;
  }

  throw new Error('Report instructions repair could not be queued. Refresh and try again.');
}

export async function saveGuildSetup(guildId: string, formData: FormData): Promise<void> {
  const [session, token] = await Promise.all([getCurrentAdminSession(), getCurrentDiscordToken()]);
  if (!session || !token) {
    redirect(`/api/auth/discord?returnTo=/admin/guild/${guildId}/setup`);
  }

  const service = createSetupDashboardService();
  const [guild, currentServer] = await Promise.all([
    service.assertCanManageGuild(guildId, token.accessToken),
    createSetupDataAdapter().getServer(guildId),
  ]);
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
    moderationQueueChannelId: readOptionalFormString(formData, 'moderationQueueChannelId'),
    reportInstructionsChannelId: readOptionalFormString(formData, 'reportInstructionsChannelId'),
    heuristicMessageThreshold: readOptionalIntegerFormValue(formData, 'heuristicMessageThreshold'),
    heuristicMessageTimeframeSeconds: readOptionalIntegerFormValue(
      formData,
      'heuristicMessageTimeframeSeconds'
    ),
    heuristicSuspiciousKeywords: readHeuristicKeywords(formData),
    detectionResponseMode: readMode(formData, 'detectionResponseMode'),
    messageDetectionResponseMode: readNullableMode(formData, 'messageDetectionResponseMode'),
    joinDetectionResponseMode: readNullableMode(formData, 'joinDetectionResponseMode'),
    observedDetectionMinConfidenceThreshold: readOptionalIntegerFormValue(
      formData,
      'observedDetectionMinConfidenceThreshold'
    ),
    observedDetectionNotificationWindowMinutes: readOptionalIntegerFormValue(
      formData,
      'observedDetectionNotificationWindowMinutes'
    ),
    automaticDetectionExemptModerators: formData.get('automaticDetectionExemptModerators') === 'on',
    adminCaseOpenRequiresReason: formData.get('adminCaseOpenRequiresReason') === 'on',
    moderatorBanActionRequiresReason: formData.get('moderatorBanActionRequiresReason') === 'on',
    moderatorKickActionRequiresReason: formData.get('moderatorKickActionRequiresReason') === 'on',
    moderatorBanActionEnabled: formData.get('moderatorBanActionEnabled') === 'on',
    moderatorKickActionEnabled: formData.get('moderatorKickActionEnabled') === 'on',
    observedActionKickEnabled: formData.get('observedActionKickEnabled') === 'on',
    messageDetectionAutoKickEnabled: formData.get('messageDetectionAutoKickEnabled') === 'on',
    joinDetectionAutoKickEnabled: formData.get('joinDetectionAutoKickEnabled') === 'on',
    reportIntakeAutoKickEnabled: formData.get('reportIntakeAutoKickEnabled') === 'on',
    autoKickMinConfidenceThreshold: readOptionalIntegerFormValue(
      formData,
      'autoKickMinConfidenceThreshold'
    ),
    userReportReasonRequired: formData.get('userReportReasonRequired') === 'on',
    userReportExternalResponseMode: readOptionalFormValue(
      formData,
      'userReportExternalResponseMode'
    ),
    reportIntakeConfirmedResponseMode: readOptionalFormValue(
      formData,
      'reportIntakeConfirmedResponseMode'
    ),
    analyticsConsentLevel: readOptionalFormValue(formData, 'analyticsConsentLevel'),
    caseReviewRemindersEnabled: formData.get('caseReviewRemindersEnabled') === 'on',
    caseReviewReminderStaleHours: readOptionalIntegerFormValue(
      formData,
      'caseReviewReminderStaleHours'
    ),
    caseReviewReminderRepeatHours: readOptionalIntegerFormValue(
      formData,
      'caseReviewReminderRepeatHours'
    ),
    caseReviewVeryStaleDays: readOptionalIntegerFormValue(formData, 'caseReviewVeryStaleDays'),
    reportAiTriageEnabled: formData.get('reportAiTriageEnabled') === 'on',
    reportAiAnalyzeText: formData.get('reportAiAnalyzeText') === 'on',
    reportAiAnalyzeImages: formData.get('reportAiAnalyzeImages') === 'on',
    reportAiMaxAction: readOptionalFormValue(formData, 'reportAiMaxAction'),
    reportAiOpenCaseThreshold: readOptionalNumberFormValue(formData, 'reportAiOpenCaseThreshold'),
    reportAiMaxImages: readOptionalIntegerFormValue(formData, 'reportAiMaxImages'),
    reportAiMaxImageBytes: readOptionalMegabytesAsBytes(formData, 'reportAiMaxImageMb'),
    roleGateEnabled: formData.get('roleGateEnabled') === 'on',
    honeypotRoleId: readOptionalFormString(formData, 'honeypotRoleId'),
    memberAccessRoleId: readOptionalFormString(formData, 'memberAccessRoleId'),
    honeypotRoleResponseMode: readMode(formData, 'honeypotRoleResponseMode'),
    roleQuarantineMode: readOptionalFormValue(formData, 'roleQuarantineMode'),
    roleQuarantineExemptRoleIds: readFormStringArray(formData, 'roleQuarantineExemptRoleIds'),
    manualIntakeEnabled: formData.get('manualIntakeEnabled') === 'on',
    manualIntakeRoleId: readOptionalFormString(formData, 'manualIntakeRoleId'),
    manualIntakeGracePeriodSeconds: readOptionalIntegerFormValue(
      formData,
      'manualIntakeGracePeriodSeconds'
    ),
    caseRoleLockdownAllowedChannelIds: readFormStringArray(
      formData,
      'caseRoleLockdownAllowedChannelIds'
    ),
    caseRoleLockdownAllowedCategoryIds: readFormStringArray(
      formData,
      'caseRoleLockdownAllowedCategoryIds'
    ),
    verificationAnalysisEnabled: formData.get('verificationAnalysisEnabled') === 'on',
    verificationAnalysisMessageLimit: readOptionalIntegerFormValue(
      formData,
      'verificationAnalysisMessageLimit'
    ),
    verificationAnalysisMaxAction: readOptionalFormValue(formData, 'verificationAnalysisMaxAction'),
    verificationAnalysisRestrictThreshold: readOptionalNumberFormValue(
      formData,
      'verificationAnalysisRestrictThreshold'
    ),
    verificationPromptTemplate: readRequiredFormStringOrNull(
      formData,
      'verificationPromptTemplate'
    ),
    serverAbout: readRequiredFormStringOrNull(formData, 'serverAbout'),
    verificationContext: readRequiredFormStringOrNull(formData, 'verificationContext'),
    expectedTopics: readExpectedTopics(formData),
    caseResponderRoleIds: readFormStringArray(formData, 'caseResponderRoleIds'),
    caseResponderRoutingMode: readOptionalFormValue(formData, 'caseResponderRoutingMode'),
    caseResponderThreadMemberCap: readOptionalIntegerFormValue(
      formData,
      'caseResponderThreadMemberCap'
    ),
    messageDeletionEnabled: formData.get('messageDeletionEnabled') === 'on',
    messageDeletionSourceMessageEnabled:
      formData.get('messageDeletionSourceMessageEnabled') === 'on',
    messageDeletionWatchlistEnabled: formData.get('messageDeletionWatchlistEnabled') === 'on',
    messageDeletionWatchlistCustomTerms: readWatchlistCustomTerms(formData),
  });
  assertCanUpdateAnalyticsConsent({
    currentLevel: currentServer?.settings.analytics_consent_level,
    guildOwner: guild.owner,
    nextLevel: update.analyticsConsentLevel,
  });

  await service.updateGuildSetup(update);
  revalidatePath(`/admin/guild/${guildId}/setup`);
}
