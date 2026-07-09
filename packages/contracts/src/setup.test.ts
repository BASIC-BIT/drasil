import { describe, expect, it } from 'vitest';
import {
  AUTO_KICK_MAX_CONFIDENCE_THRESHOLD,
  AUTO_KICK_MIN_CONFIDENCE_THRESHOLD,
  CASE_RESPONDER_MAX_THREAD_MEMBER_CAP,
  CASE_RESPONDER_MIN_THREAD_MEMBER_CAP,
  CASE_REVIEW_REMINDER_MAX_HOURS,
  CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS,
  CASE_REVIEW_REMINDER_MIN_HOURS,
  CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS,
  HEURISTIC_MAX_KEYWORDS,
  HEURISTIC_MAX_MESSAGE_THRESHOLD,
  HEURISTIC_MAX_TIMEFRAME_SECONDS,
  HEURISTIC_MIN_MESSAGE_THRESHOLD,
  HEURISTIC_MIN_TIMEFRAME_SECONDS,
  MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS,
  MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS,
  OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD,
  OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES,
  OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD,
  OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES,
  REPORT_AI_MAX_MAX_IMAGE_BYTES,
  REPORT_AI_MAX_MAX_IMAGES,
  REPORT_AI_MAX_OPEN_CASE_THRESHOLD,
  REPORT_AI_MIN_MAX_IMAGE_BYTES,
  REPORT_AI_MIN_MAX_IMAGES,
  REPORT_AI_MIN_OPEN_CASE_THRESHOLD,
  VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT,
  VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD,
  VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT,
  VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD,
  EXPECTED_TOPICS_INPUT_MAX_LENGTH,
  SERVER_ABOUT_MAX_LENGTH,
  VERIFICATION_CONTEXT_MAX_LENGTH,
  VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH,
  guildSetupUpdateSchema,
  MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH,
  MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES,
  setupDashboardSchema,
} from './setup';

describe('setup contracts', () => {
  it('accepts dashboard payloads with nullable server config', () => {
    const parsed = setupDashboardSchema.parse({
      guildId: '123',
      guildName: 'Test Guild',
      configured: false,
      dataProvider: 'postgres',
      checkedAt: new Date(0).toISOString(),
      checklist: [],
      server: null,
    });

    expect(parsed.configured).toBe(false);
  });

  it('rejects unsupported setup update modes', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      detectionResponseMode: 'ban_everyone',
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts bounded heuristic detection settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      heuristicMessageThreshold: HEURISTIC_MAX_MESSAGE_THRESHOLD,
      heuristicMessageTimeframeSeconds: HEURISTIC_MAX_TIMEFRAME_SECONDS,
      heuristicSuspiciousKeywords: ['example watch term'],
    });

    expect(parsed).toMatchObject({
      heuristicMessageThreshold: HEURISTIC_MAX_MESSAGE_THRESHOLD,
      heuristicMessageTimeframeSeconds: HEURISTIC_MAX_TIMEFRAME_SECONDS,
      heuristicSuspiciousKeywords: ['example watch term'],
    });
  });

  it('rejects heuristic detection settings outside Discord command bounds', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      heuristicMessageThreshold: HEURISTIC_MIN_MESSAGE_THRESHOLD - 1,
      heuristicMessageTimeframeSeconds: HEURISTIC_MIN_TIMEFRAME_SECONDS - 1,
      heuristicSuspiciousKeywords: Array.from(
        { length: HEURISTIC_MAX_KEYWORDS + 1 },
        (_item, index) => `keyword-${index}`
      ),
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts expanded detection response policy settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      moderationQueueChannelId: 'queue-channel',
      observedDetectionMinConfidenceThreshold: OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD,
      observedDetectionNotificationWindowMinutes:
        OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES,
      automaticDetectionExemptModerators: true,
      adminCaseOpenRequiresReason: true,
      moderatorBanActionRequiresReason: true,
      moderatorKickActionRequiresReason: true,
      moderatorBanActionEnabled: false,
      moderatorKickActionEnabled: false,
      observedActionKickEnabled: true,
      messageDetectionAutoKickEnabled: true,
      joinDetectionAutoKickEnabled: true,
      reportIntakeAutoKickEnabled: true,
      autoKickMinConfidenceThreshold: AUTO_KICK_MAX_CONFIDENCE_THRESHOLD,
    });

    expect(parsed).toMatchObject({
      moderationQueueChannelId: 'queue-channel',
      observedDetectionMinConfidenceThreshold: OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD,
      observedDetectionNotificationWindowMinutes:
        OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES,
      automaticDetectionExemptModerators: true,
      adminCaseOpenRequiresReason: true,
      moderatorBanActionEnabled: false,
      observedActionKickEnabled: true,
      autoKickMinConfidenceThreshold: AUTO_KICK_MAX_CONFIDENCE_THRESHOLD,
    });
  });

  it('rejects expanded detection response policy values outside Discord command bounds', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      observedDetectionMinConfidenceThreshold: OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD - 1,
      observedDetectionNotificationWindowMinutes:
        OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES - 1,
      autoKickMinConfidenceThreshold: AUTO_KICK_MIN_CONFIDENCE_THRESHOLD - 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts bounded manual intake settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      caseRoleId: 'case-role',
      manualIntakeEnabled: true,
      manualIntakeRoleId: 'manual-role',
      manualIntakeGracePeriodSeconds: MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS,
    });

    expect(parsed).toMatchObject({
      manualIntakeEnabled: true,
      manualIntakeRoleId: 'manual-role',
      manualIntakeGracePeriodSeconds: MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS,
    });
  });

  it('rejects manual intake settings that Discord would reject', () => {
    const missingRole = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      manualIntakeEnabled: true,
      manualIntakeRoleId: null,
    });
    const caseRoleReuse = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      caseRoleId: 'case-role',
      manualIntakeRoleId: 'case-role',
    });
    const invalidGracePeriod = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      manualIntakeGracePeriodSeconds: MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS - 1,
    });

    expect(missingRole.success).toBe(false);
    expect(caseRoleReuse.success).toBe(false);
    expect(invalidGracePeriod.success).toBe(false);
  });

  it('accepts case role lockdown allow-list settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      caseRoleLockdownAllowedChannelIds: ['channel-1'],
      caseRoleLockdownAllowedCategoryIds: ['category-1'],
    });

    expect(parsed).toMatchObject({
      caseRoleLockdownAllowedChannelIds: ['channel-1'],
      caseRoleLockdownAllowedCategoryIds: ['category-1'],
    });
  });

  it('accepts bounded case review reminder settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      caseReviewRemindersEnabled: false,
      caseReviewReminderStaleHours: CASE_REVIEW_REMINDER_MIN_HOURS,
      caseReviewReminderRepeatHours: CASE_REVIEW_REMINDER_MAX_HOURS,
      caseReviewVeryStaleDays: CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS,
    });

    expect(parsed).toMatchObject({
      caseReviewRemindersEnabled: false,
      caseReviewReminderStaleHours: CASE_REVIEW_REMINDER_MIN_HOURS,
      caseReviewReminderRepeatHours: CASE_REVIEW_REMINDER_MAX_HOURS,
      caseReviewVeryStaleDays: CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS,
    });
  });

  it('rejects case review reminder values outside Discord command bounds', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      caseReviewReminderStaleHours: CASE_REVIEW_REMINDER_MIN_HOURS - 1,
      caseReviewReminderRepeatHours: CASE_REVIEW_REMINDER_MAX_HOURS + 1,
      caseReviewVeryStaleDays: CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS - 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts bounded case responder staff settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      caseResponderRoleIds: ['admin-role'],
      caseResponderRoutingMode: 'ping_and_add_members',
      caseResponderThreadMemberCap: CASE_RESPONDER_MAX_THREAD_MEMBER_CAP,
    });

    expect(parsed).toMatchObject({
      caseResponderRoleIds: ['admin-role'],
      caseResponderRoutingMode: 'ping_and_add_members',
      caseResponderThreadMemberCap: CASE_RESPONDER_MAX_THREAD_MEMBER_CAP,
    });
  });

  it('rejects unsupported case responder routing and member caps', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      caseResponderRoutingMode: 'add_everyone',
      caseResponderThreadMemberCap: CASE_RESPONDER_MIN_THREAD_MEMBER_CAP - 1,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts bounded verification analysis settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      verificationAnalysisEnabled: true,
      verificationAnalysisMessageLimit: VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT,
      verificationAnalysisMaxAction: 'restrict',
      verificationAnalysisRestrictThreshold: VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD,
    });

    expect(parsed).toMatchObject({
      verificationAnalysisEnabled: true,
      verificationAnalysisMessageLimit: VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT,
      verificationAnalysisMaxAction: 'restrict',
      verificationAnalysisRestrictThreshold: VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD,
    });
  });

  it('rejects unsupported verification analysis settings', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      verificationAnalysisMessageLimit: VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT - 1,
      verificationAnalysisMaxAction: 'open_case',
      verificationAnalysisRestrictThreshold: VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD - 0.01,
    });

    expect(parsed.success).toBe(false);
  });

  it('accepts bounded report policy and role gate settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      reportIntakeConfirmedResponseMode: 'open_case',
      reportAiAnalyzeText: true,
      reportAiAnalyzeImages: false,
      reportAiOpenCaseThreshold: REPORT_AI_MAX_OPEN_CASE_THRESHOLD,
      reportAiMaxImages: REPORT_AI_MAX_MAX_IMAGES,
      reportAiMaxImageBytes: REPORT_AI_MAX_MAX_IMAGE_BYTES,
      roleGateEnabled: true,
      honeypotRoleId: 'honeypot-role',
      memberAccessRoleId: null,
      honeypotRoleResponseMode: 'notify_only',
      roleQuarantineMode: 'on',
      roleQuarantineExemptRoleIds: ['admin-role'],
    });

    expect(parsed).toMatchObject({
      reportIntakeConfirmedResponseMode: 'open_case',
      reportAiAnalyzeText: true,
      reportAiAnalyzeImages: false,
      reportAiOpenCaseThreshold: REPORT_AI_MAX_OPEN_CASE_THRESHOLD,
      reportAiMaxImages: REPORT_AI_MAX_MAX_IMAGES,
      reportAiMaxImageBytes: REPORT_AI_MAX_MAX_IMAGE_BYTES,
      roleGateEnabled: true,
      honeypotRoleId: 'honeypot-role',
      memberAccessRoleId: null,
      honeypotRoleResponseMode: 'notify_only',
      roleQuarantineMode: 'on',
      roleQuarantineExemptRoleIds: ['admin-role'],
    });
  });

  it('rejects unsupported report policy and role gate settings', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      reportIntakeConfirmedResponseMode: 'auto_ban',
      reportAiOpenCaseThreshold: REPORT_AI_MIN_OPEN_CASE_THRESHOLD - 0.01,
      reportAiMaxImages: REPORT_AI_MIN_MAX_IMAGES - 1,
      reportAiMaxImageBytes: REPORT_AI_MIN_MAX_IMAGE_BYTES - 1,
      honeypotRoleResponseMode: 'auto_ban',
      roleQuarantineMode: 'audit_only',
    });

    expect(parsed.success).toBe(false);
  });

  it('normalizes legacy automatic open_case modes to notify_only', () => {
    const parsed = setupDashboardSchema.parse({
      guildId: '123',
      guildName: 'Test Guild',
      configured: true,
      dataProvider: 'postgres',
      checkedAt: new Date(0).toISOString(),
      checklist: [],
      server: {
        guild_id: '123',
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        admin_notification_role_id: null,
        heuristic_message_threshold: 5,
        heuristic_message_timeframe_seconds: 60,
        heuristic_suspicious_keywords: [],
        created_at: null,
        updated_at: null,
        updated_by: null,
        settings: {
          detection_response_mode: 'open_case',
          message_detection_response_mode: 'open_case',
          join_detection_response_mode: 'open_case',
          user_report_external_response_mode: 'open_case',
        },
        is_active: true,
      },
    });

    expect(parsed.server?.settings).toMatchObject({
      detection_response_mode: 'notify_only',
      message_detection_response_mode: 'notify_only',
      join_detection_response_mode: 'notify_only',
      user_report_external_response_mode: 'open_case',
    });
  });

  it('normalizes legacy report AI restrict authority to open_case', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      reportAiMaxAction: 'restrict',
    });

    expect(parsed.reportAiMaxAction).toBe('open_case');
  });

  it('normalizes verification analysis open_case wording to restrict', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      verificationAnalysisMaxAction: 'open_case',
    });

    expect(parsed.verificationAnalysisMaxAction).toBe('restrict');
  });

  it('accepts bounded verification prompt and context settings', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      verificationPromptTemplate: 'Hello {user_mention} in {server_name}',
      serverAbout: 'x'.repeat(SERVER_ABOUT_MAX_LENGTH),
      verificationContext: 'x'.repeat(VERIFICATION_CONTEXT_MAX_LENGTH),
      expectedTopics: ['setup', 'reports'],
    });

    expect(parsed).toMatchObject({
      verificationPromptTemplate: 'Hello {user_mention} in {server_name}',
      serverAbout: 'x'.repeat(SERVER_ABOUT_MAX_LENGTH),
      verificationContext: 'x'.repeat(VERIFICATION_CONTEXT_MAX_LENGTH),
      expectedTopics: ['setup', 'reports'],
    });
  });

  it('accepts null verification prompt and context fields for reset', () => {
    const parsed = guildSetupUpdateSchema.parse({
      guildId: '123',
      verificationPromptTemplate: null,
      serverAbout: null,
      verificationContext: null,
      expectedTopics: [],
    });

    expect(parsed).toMatchObject({
      verificationPromptTemplate: null,
      serverAbout: null,
      verificationContext: null,
      expectedTopics: [],
    });
  });

  it('rejects oversized verification prompt and context settings', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      verificationPromptTemplate: 'x'.repeat(VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH + 1),
      serverAbout: 'x'.repeat(SERVER_ABOUT_MAX_LENGTH + 1),
      verificationContext: 'x'.repeat(VERIFICATION_CONTEXT_MAX_LENGTH + 1),
    });

    expect(parsed.success).toBe(false);
    expect(EXPECTED_TOPICS_INPUT_MAX_LENGTH).toBe(1000);
  });

  it('rejects custom message deletion watchlist terms over the bot matching limit', () => {
    const parsed = guildSetupUpdateSchema.safeParse({
      guildId: '123',
      messageDeletionWatchlistCustomTerms: [
        'x'.repeat(MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH + 1),
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('does not ship default global watchlist entries in source code', () => {
    expect(MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES).toEqual([]);
  });
});
