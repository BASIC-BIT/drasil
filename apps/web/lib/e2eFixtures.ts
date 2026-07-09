import type {
  CaseDetail,
  CaseSummary,
  GuildSetupUpdate,
  SetupServerRecord,
} from '@drasil/contracts';
import { DISCORD_PERMISSIONS } from './discordPermissions';
import { readOptionalEnv, isProduction } from './env';
import {
  fixtureCaseDetails,
  fixtureCaseSummaries,
  fixtureResolvedCaseDetails,
  fixtureResolvedCaseSummaries,
} from './caseFixtures';
import type { AdminSession, DiscordTokenSession } from './session';
import type { DiscordGuildResources, DiscordGuildSummary } from './discordApi';

export const fixtureGuildId = 'guild-1';
export const fixtureGuildName = 'Fixture Guild';
export const fixtureSecondGuildId = 'guild-2';
export const fixtureSecondGuildName = 'Quiet Guild';
export const fixtureTimestampIso = '2026-06-08T01:16:02.000Z';

export function isWebE2eFixtureMode(): boolean {
  const enabled = readOptionalEnv('DRASIL_WEB_E2E_FIXTURE_MODE') === 'true';
  if (enabled && isProduction()) {
    throw new Error('DRASIL_WEB_E2E_FIXTURE_MODE must not be enabled in production.');
  }
  return enabled;
}

export function fixtureAdminSession(): AdminSession {
  const issuedAt = Date.now();
  return {
    userId: 'fixture-admin',
    username: 'Fixture Admin',
    avatarUrl: null,
    issuedAt,
    expiresAt: issuedAt + 60 * 60 * 1000,
  };
}

export function fixtureDiscordToken(): DiscordTokenSession {
  return {
    accessToken: 'fixture-access-token',
    expiresAt: Date.now() + 60 * 60 * 1000,
  };
}

export function fixtureGuilds(): DiscordGuildSummary[] {
  return [
    {
      id: fixtureGuildId,
      name: fixtureGuildName,
      icon: null,
      owner: true,
      permissions: String(DISCORD_PERMISSIONS.ManageGuild),
    },
    {
      id: fixtureSecondGuildId,
      name: fixtureSecondGuildName,
      icon: null,
      owner: false,
      permissions: String(DISCORD_PERMISSIONS.ManageGuild),
    },
  ];
}

export function fixtureGuildResources(): DiscordGuildResources {
  const botPermissions = String(
    DISCORD_PERMISSIONS.ManageRoles |
      DISCORD_PERMISSIONS.KickMembers |
      DISCORD_PERMISSIONS.BanMembers |
      DISCORD_PERMISSIONS.ViewAuditLog |
      DISCORD_PERMISSIONS.ManageChannels |
      DISCORD_PERMISSIONS.ViewChannel |
      DISCORD_PERMISSIONS.SendMessages |
      DISCORD_PERMISSIONS.ManageMessages |
      DISCORD_PERMISSIONS.EmbedLinks |
      DISCORD_PERMISSIONS.ReadMessageHistory |
      DISCORD_PERMISSIONS.ManageThreads |
      DISCORD_PERMISSIONS.CreatePrivateThreads |
      DISCORD_PERMISSIONS.SendMessagesInThreads
  );
  return {
    botUser: { id: 'bot-1', username: 'Drasil', avatar: null },
    botMember: { roles: ['bot-role'] },
    roles: [
      { id: fixtureGuildId, name: '@everyone', permissions: '0', position: 0, managed: false },
      { id: 'case-role', name: 'Case Role', permissions: '0', position: 1, managed: false },
      {
        id: 'manual-intake-role',
        name: 'Manual Intake',
        permissions: '0',
        position: 2,
        managed: false,
      },
      {
        id: 'admin-role',
        name: 'Moderators',
        permissions: botPermissions,
        position: 3,
        managed: false,
      },
      { id: 'bot-role', name: 'Drasil', permissions: botPermissions, position: 4, managed: false },
    ],
    channels: [
      { id: 'public-category-1', name: 'public spaces', type: 4 },
      { id: 'admin-channel-1', name: 'drasil-admin', type: 0 },
      { id: 'verification-channel-1', name: 'verification', type: 0 },
      { id: 'queue-channel-1', name: 'moderation-queue', type: 0 },
      { id: 'report-channel-1', name: 'report-scam', type: 0 },
      { id: 'rules-channel-1', name: 'rules', type: 0 },
    ],
  };
}

export function fixtureServerRecord(): SetupServerRecord {
  return {
    guild_id: fixtureGuildId,
    case_role_id: 'case-role',
    admin_channel_id: 'admin-channel-1',
    verification_channel_id: 'verification-channel-1',
    admin_notification_role_id: 'admin-role',
    heuristic_message_threshold: 5,
    heuristic_message_timeframe_seconds: 10,
    heuristic_suspicious_keywords: ['example watch term', 'sample review phrase'],
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-03T00:00:00.000Z',
    updated_by: 'fixture-admin',
    settings: {
      detection_response_mode: 'restrict',
      moderation_queue_channel_id: 'queue-channel-1',
      report_instructions_channel_id: 'report-channel-1',
      report_intake_confirmed_response_mode: 'observed_alert',
      case_review_reminders_enabled: true,
      case_review_reminder_stale_hours: 24,
      case_review_reminder_repeat_hours: 24,
      case_review_very_stale_days: 3,
      case_responder_role_ids: [],
      case_responder_routing_mode: 'off',
      case_responder_thread_member_cap: 25,
      report_ai_triage_enabled: true,
      report_ai_analyze_text: true,
      report_ai_analyze_images: true,
      report_ai_max_action: 'open_case',
      report_ai_open_case_threshold: 0.85,
      report_ai_max_images: 4,
      report_ai_max_image_bytes: 10 * 1024 * 1024,
      role_gate_enabled: false,
      honeypot_role_id: null,
      member_access_role_id: null,
      honeypot_role_response_mode: 'restrict',
      role_quarantine_mode: 'off',
      role_quarantine_exempt_role_ids: [],
      verification_ai_thread_analysis_enabled: true,
      verification_ai_thread_analysis_message_limit: 3,
      verification_ai_max_action: 'hints',
      verification_ai_restrict_threshold: 0.95,
      verification_prompt_template: null,
      server_about: 'A fixture server for moderation workbench testing.',
      verification_context: 'Legitimate fixture members mention setup, reports, and moderation.',
      expected_topics: ['setup', 'reports', 'moderation'],
      observed_detection_min_confidence_threshold: 70,
      observed_detection_notification_window_minutes: 60,
      automatic_detection_exempt_moderators: true,
      admin_case_open_requires_reason: false,
      moderator_ban_action_requires_reason: false,
      moderator_kick_action_requires_reason: false,
      moderator_ban_action_enabled: true,
      moderator_kick_action_enabled: true,
      observed_action_kick_enabled: false,
      message_detection_auto_kick_enabled: false,
      join_detection_auto_kick_enabled: false,
      report_intake_auto_kick_enabled: false,
      auto_kick_min_confidence_threshold: 95,
      manual_intake_enabled: true,
      manual_intake_role_id: 'manual-intake-role',
      manual_intake_grace_period_seconds: 30,
      case_role_lockdown_enabled: true,
      case_role_lockdown_allowed_channel_ids: ['rules-channel-1'],
      case_role_lockdown_allowed_category_ids: ['public-category-1'],
    },
    is_active: true,
  };
}

function setIfDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function applyFixtureServerSettingsUpdate(
  settings: Record<string, unknown>,
  update: GuildSetupUpdate
): void {
  setIfDefined(
    settings,
    'observed_detection_notification_channel_id',
    update.observedNotificationChannelId
  );
  setIfDefined(settings, 'report_instructions_channel_id', update.reportInstructionsChannelId);
  setIfDefined(settings, 'moderation_queue_channel_id', update.moderationQueueChannelId);
  setIfDefined(settings, 'detection_response_mode', update.detectionResponseMode);
  setIfDefined(settings, 'message_detection_response_mode', update.messageDetectionResponseMode);
  setIfDefined(settings, 'join_detection_response_mode', update.joinDetectionResponseMode);
  setIfDefined(
    settings,
    'observed_detection_min_confidence_threshold',
    update.observedDetectionMinConfidenceThreshold
  );
  setIfDefined(
    settings,
    'observed_detection_notification_window_minutes',
    update.observedDetectionNotificationWindowMinutes
  );
  setIfDefined(
    settings,
    'automatic_detection_exempt_moderators',
    update.automaticDetectionExemptModerators
  );
  setIfDefined(settings, 'admin_case_open_requires_reason', update.adminCaseOpenRequiresReason);
  setIfDefined(
    settings,
    'moderator_ban_action_requires_reason',
    update.moderatorBanActionRequiresReason
  );
  setIfDefined(
    settings,
    'moderator_kick_action_requires_reason',
    update.moderatorKickActionRequiresReason
  );
  setIfDefined(settings, 'moderator_ban_action_enabled', update.moderatorBanActionEnabled);
  setIfDefined(settings, 'moderator_kick_action_enabled', update.moderatorKickActionEnabled);
  setIfDefined(settings, 'observed_action_kick_enabled', update.observedActionKickEnabled);
  setIfDefined(
    settings,
    'message_detection_auto_kick_enabled',
    update.messageDetectionAutoKickEnabled
  );
  setIfDefined(settings, 'join_detection_auto_kick_enabled', update.joinDetectionAutoKickEnabled);
  setIfDefined(settings, 'report_intake_auto_kick_enabled', update.reportIntakeAutoKickEnabled);
  setIfDefined(
    settings,
    'auto_kick_min_confidence_threshold',
    update.autoKickMinConfidenceThreshold
  );
  setIfDefined(settings, 'manual_intake_enabled', update.manualIntakeEnabled);
  setIfDefined(settings, 'manual_intake_role_id', update.manualIntakeRoleId);
  setIfDefined(
    settings,
    'manual_intake_grace_period_seconds',
    update.manualIntakeGracePeriodSeconds
  );
  setIfDefined(
    settings,
    'case_role_lockdown_allowed_channel_ids',
    update.caseRoleLockdownAllowedChannelIds
  );
  setIfDefined(
    settings,
    'case_role_lockdown_allowed_category_ids',
    update.caseRoleLockdownAllowedCategoryIds
  );
  setIfDefined(settings, 'user_report_reason_required', update.userReportReasonRequired);
  setIfDefined(
    settings,
    'user_report_external_response_mode',
    update.userReportExternalResponseMode
  );
  setIfDefined(
    settings,
    'report_intake_confirmed_response_mode',
    update.reportIntakeConfirmedResponseMode
  );
  setIfDefined(settings, 'analytics_consent_level', update.analyticsConsentLevel);
  setIfDefined(settings, 'case_review_reminders_enabled', update.caseReviewRemindersEnabled);
  setIfDefined(settings, 'case_review_reminder_stale_hours', update.caseReviewReminderStaleHours);
  setIfDefined(settings, 'case_review_reminder_repeat_hours', update.caseReviewReminderRepeatHours);
  setIfDefined(settings, 'case_review_very_stale_days', update.caseReviewVeryStaleDays);
  setIfDefined(settings, 'report_ai_triage_enabled', update.reportAiTriageEnabled);
  setIfDefined(settings, 'report_ai_analyze_text', update.reportAiAnalyzeText);
  setIfDefined(settings, 'report_ai_analyze_images', update.reportAiAnalyzeImages);
  setIfDefined(settings, 'report_ai_max_action', update.reportAiMaxAction);
  setIfDefined(settings, 'report_ai_open_case_threshold', update.reportAiOpenCaseThreshold);
  setIfDefined(settings, 'report_ai_max_images', update.reportAiMaxImages);
  setIfDefined(settings, 'report_ai_max_image_bytes', update.reportAiMaxImageBytes);
  setIfDefined(settings, 'role_gate_enabled', update.roleGateEnabled);
  setIfDefined(settings, 'honeypot_role_id', update.honeypotRoleId);
  setIfDefined(settings, 'member_access_role_id', update.memberAccessRoleId);
  setIfDefined(settings, 'honeypot_role_response_mode', update.honeypotRoleResponseMode);
  setIfDefined(settings, 'role_quarantine_mode', update.roleQuarantineMode);
  setIfDefined(settings, 'role_quarantine_exempt_role_ids', update.roleQuarantineExemptRoleIds);
  setIfDefined(
    settings,
    'verification_ai_thread_analysis_enabled',
    update.verificationAnalysisEnabled
  );
  setIfDefined(
    settings,
    'verification_ai_thread_analysis_message_limit',
    update.verificationAnalysisMessageLimit
  );
  setIfDefined(settings, 'verification_ai_max_action', update.verificationAnalysisMaxAction);
  setIfDefined(
    settings,
    'verification_ai_restrict_threshold',
    update.verificationAnalysisRestrictThreshold
  );
  setIfDefined(settings, 'verification_prompt_template', update.verificationPromptTemplate);
  setIfDefined(settings, 'server_about', update.serverAbout);
  setIfDefined(settings, 'verification_context', update.verificationContext);
  setIfDefined(settings, 'expected_topics', update.expectedTopics);
  setIfDefined(settings, 'case_responder_role_ids', update.caseResponderRoleIds);
  setIfDefined(settings, 'case_responder_routing_mode', update.caseResponderRoutingMode);
  setIfDefined(settings, 'case_responder_thread_member_cap', update.caseResponderThreadMemberCap);
  setIfDefined(settings, 'message_deletion_enabled', update.messageDeletionEnabled);
  setIfDefined(
    settings,
    'message_deletion_source_message_enabled',
    update.messageDeletionSourceMessageEnabled
  );
  setIfDefined(
    settings,
    'message_deletion_watchlist_enabled',
    update.messageDeletionWatchlistEnabled
  );
  setIfDefined(
    settings,
    'message_deletion_watchlist_disabled_default_ids',
    update.messageDeletionWatchlistDisabledDefaultIds
  );
  setIfDefined(
    settings,
    'message_deletion_watchlist_custom_terms',
    update.messageDeletionWatchlistCustomTerms
  );
}

export function updateFixtureServerRecord(update: GuildSetupUpdate): SetupServerRecord {
  const current = fixtureServerRecord();
  const settings = { ...current.settings };
  applyFixtureServerSettingsUpdate(settings, update);

  return {
    ...current,
    case_role_id: update.caseRoleId !== undefined ? update.caseRoleId : current.case_role_id,
    admin_channel_id:
      update.adminChannelId !== undefined ? update.adminChannelId : current.admin_channel_id,
    verification_channel_id:
      update.verificationChannelId !== undefined
        ? update.verificationChannelId
        : current.verification_channel_id,
    admin_notification_role_id:
      update.adminNotificationRoleId !== undefined
        ? update.adminNotificationRoleId
        : current.admin_notification_role_id,
    heuristic_message_threshold:
      update.heuristicMessageThreshold !== undefined
        ? update.heuristicMessageThreshold
        : current.heuristic_message_threshold,
    heuristic_message_timeframe_seconds:
      update.heuristicMessageTimeframeSeconds !== undefined
        ? update.heuristicMessageTimeframeSeconds
        : current.heuristic_message_timeframe_seconds,
    heuristic_suspicious_keywords:
      update.heuristicSuspiciousKeywords !== undefined
        ? update.heuristicSuspiciousKeywords
        : current.heuristic_suspicious_keywords,
    settings,
    updated_by: update.updatedBy ?? current.updated_by,
    updated_at: fixtureTimestampIso,
  };
}

export function fixtureActiveCaseSummaries(): CaseSummary[] {
  return fixtureCaseSummaries();
}

export function fixtureResolvedCaseSummariesForHistory(): CaseSummary[] {
  return fixtureResolvedCaseSummaries();
}

export function fixtureResolvedCaseCount(): number {
  return fixtureResolvedCaseSummariesForHistory().length;
}

export function fixtureActiveCaseDetail(caseId: string): CaseDetail | null {
  return (
    fixtureCaseDetails.find((item) => item.id === caseId) ??
    fixtureResolvedCaseDetails.find((item) => item.id === caseId) ??
    null
  );
}
