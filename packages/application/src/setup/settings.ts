import { z } from 'zod';

const activeDetectionResponseModeSchema = z.enum(['off', 'record_only', 'notify_only', 'restrict']);

export const detectionResponseModeSchema = z.preprocess(
  (value) => (value === 'open_case' ? 'notify_only' : value),
  activeDetectionResponseModeSchema
);

export const userReportExternalResponseModeSchema = z.enum(['off', 'notify_only', 'open_case']);
export const analyticsConsentLevelSchema = z.enum(['off', 'anonymous', 'full']);
const activeReportAiMaxActionSchema = z.enum(['off', 'hints', 'open_case']);
const activeVerificationAiMaxActionSchema = z.enum(['off', 'hints', 'restrict']);
export const reportIntakeConfirmedResponseModeSchema = z.enum([
  'observed_alert',
  'open_case',
  'kick',
]);

export const reportAiMaxActionSchema = z.preprocess(
  (value) => (value === 'restrict' ? 'open_case' : value),
  activeReportAiMaxActionSchema
);
export const caseResponderRoutingModeSchema = z.enum(['off', 'ping_only', 'ping_and_add_members']);
export const verificationAiMaxActionSchema = z.preprocess(
  (value) => (value === 'open_case' ? 'restrict' : value),
  activeVerificationAiMaxActionSchema
);
export const roleQuarantineModeSchema = z.enum(['off', 'on']);
export const captchaModeSchema = z.enum(['off', 'manual', 'suspicious_join']);
export const captchaMethodSchema = z.enum(['none', 'discord_image', 'turnstile']);
export type CaptchaMethod = z.infer<typeof captchaMethodSchema>;

/** Preserve shipped legacy settings without rewriting unrelated saves. */
export function getEffectiveCaptchaMethod(settings: unknown): CaptchaMethod {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return 'none';
  if ('captcha_method' in settings) {
    const parsed = captchaMethodSchema.safeParse(settings.captcha_method);
    return parsed.success ? parsed.data : 'none';
  }
  return 'captcha_mode' in settings &&
    (settings.captcha_mode === 'manual' || settings.captcha_mode === 'suspicious_join')
    ? 'turnstile'
    : 'none';
}

export const captchaPassActionSchema = z.enum(['evidence_only', 'verify_join_only']);
export const CAPTCHA_DEFAULT_MODE = 'off';
export const CAPTCHA_DEFAULT_PASS_ACTION = 'evidence_only';
export const CAPTCHA_DEFAULT_CHALLENGE_LIFETIME_HOURS = 24;
export const CAPTCHA_MIN_CHALLENGE_LIFETIME_HOURS = 1;
export const CAPTCHA_MAX_CHALLENGE_LIFETIME_HOURS = 168;
export const CAPTCHA_DEFAULT_MAX_SUBMISSIONS = 5;
export const CAPTCHA_MIN_MAX_SUBMISSIONS = 1;
export const CAPTCHA_MAX_MAX_SUBMISSIONS = 20;
export const MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS = 25;
export const MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH = 120;
export const MESSAGE_DELETION_MAX_DISABLED_DEFAULT_IDS = 10;
export const CASE_REVIEW_REMINDER_DEFAULT_STALE_HOURS = 24;
export const CASE_REVIEW_REMINDER_DEFAULT_REPEAT_HOURS = 24;
export const CASE_REVIEW_REMINDER_DEFAULT_VERY_STALE_DAYS = 3;
export const CASE_REVIEW_REMINDER_MIN_HOURS = 1;
export const CASE_REVIEW_REMINDER_MAX_HOURS = 168;
export const CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS = 1;
export const CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS = 30;
export const CASE_RESPONDER_DEFAULT_THREAD_MEMBER_CAP = 25;
export const CASE_RESPONDER_MIN_THREAD_MEMBER_CAP = 1;
export const CASE_RESPONDER_MAX_THREAD_MEMBER_CAP = 100;
export const VERIFICATION_ANALYSIS_DEFAULT_ENABLED = true;
export const VERIFICATION_ANALYSIS_DEFAULT_MESSAGE_LIMIT = 3;
export const VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT = 1;
export const VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT = 10;
export const VERIFICATION_ANALYSIS_DEFAULT_MAX_ACTION = 'hints';
export const VERIFICATION_ANALYSIS_DEFAULT_RESTRICT_THRESHOLD = 0.95;
export const VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD = 0;
export const VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD = 1;
export const REPORT_AI_DEFAULT_OPEN_CASE_THRESHOLD = 0.85;
export const REPORT_AI_MIN_OPEN_CASE_THRESHOLD = 0;
export const REPORT_AI_MAX_OPEN_CASE_THRESHOLD = 1;
export const REPORT_AI_DEFAULT_MAX_IMAGES = 4;
export const REPORT_AI_MIN_MAX_IMAGES = 0;
export const REPORT_AI_MAX_MAX_IMAGES = 8;
export const REPORT_AI_DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const REPORT_AI_MIN_MAX_IMAGE_BYTES = 1;
export const REPORT_AI_MAX_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const ROLE_GATE_DEFAULT_ENABLED = false;
export const HEURISTIC_DEFAULT_MESSAGE_THRESHOLD = 5;
export const HEURISTIC_DEFAULT_TIMEFRAME_SECONDS = 10;
export const HEURISTIC_MIN_MESSAGE_THRESHOLD = 1;
export const HEURISTIC_MAX_MESSAGE_THRESHOLD = 100;
export const HEURISTIC_MIN_TIMEFRAME_SECONDS = 1;
export const HEURISTIC_MAX_TIMEFRAME_SECONDS = 600;
export const HEURISTIC_MAX_KEYWORDS = 200;
export const HEURISTIC_KEYWORDS_INPUT_MAX_LENGTH = 5000;
export const OBSERVED_DETECTION_DEFAULT_MIN_CONFIDENCE_THRESHOLD = 70;
export const OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD = 0;
export const OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD = 100;
export const OBSERVED_DETECTION_DEFAULT_NOTIFICATION_WINDOW_MINUTES = 60;
export const OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES = 1;
export const OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES = 1440;
export const AUTOMATIC_DETECTION_DEFAULT_EXEMPT_MODERATORS = true;
export const MODERATOR_BAN_ACTION_DEFAULT_ENABLED = true;
export const MODERATOR_KICK_ACTION_DEFAULT_ENABLED = true;
export const ADMIN_CASE_OPEN_DEFAULT_REQUIRES_REASON = false;
export const MODERATOR_BAN_ACTION_DEFAULT_REQUIRES_REASON = false;
export const MODERATOR_KICK_ACTION_DEFAULT_REQUIRES_REASON = false;
export const OBSERVED_ACTION_KICK_DEFAULT_ENABLED = false;
export const MESSAGE_DETECTION_AUTO_KICK_DEFAULT_ENABLED = false;
export const JOIN_DETECTION_AUTO_KICK_DEFAULT_ENABLED = false;
export const REPORT_INTAKE_AUTO_KICK_DEFAULT_ENABLED = false;
export const AUTO_KICK_DEFAULT_MIN_CONFIDENCE_THRESHOLD = 95;
export const AUTO_KICK_MIN_CONFIDENCE_THRESHOLD = 90;
export const AUTO_KICK_MAX_CONFIDENCE_THRESHOLD = 100;
export const MANUAL_INTAKE_DEFAULT_ENABLED = false;
export const MANUAL_INTAKE_DEFAULT_GRACE_PERIOD_SECONDS = 30;
export const MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS = 0;
export const MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS = 300;
export const CASE_ROLE_LOCKDOWN_DEFAULT_ENABLED = false;
export const VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH = 1500;
export const SERVER_ABOUT_MAX_LENGTH = 500;
export const VERIFICATION_CONTEXT_MAX_LENGTH = 1000;
export const EXPECTED_TOPICS_INPUT_MAX_LENGTH = 1000;

export interface MessageDeletionDefaultWatchlistEntry {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly requiresLinkOrVideo: boolean;
}

export const MESSAGE_DELETION_DEFAULT_WATCHLIST_ENTRIES: readonly MessageDeletionDefaultWatchlistEntry[] =
  [];

export const messageDeletionWatchlistDefaultIdsSchema = z
  .array(z.string())
  .max(MESSAGE_DELETION_MAX_DISABLED_DEFAULT_IDS);
export const messageDeletionWatchlistCustomTermsSchema = z
  .array(z.string().trim().min(1).max(MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH))
  .max(MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS);

export const serverSettingsSchema = z
  .object({
    min_confidence_threshold: z.number().optional(),
    auto_restrict: z.boolean().optional(),
    use_gpt_on_join: z.boolean().optional(),
    gpt_message_check_count: z.number().int().optional(),
    message_retention_days: z.number().int().optional(),
    detection_retention_days: z.number().int().optional(),
    verification_prompt_template: z
      .string()
      .max(VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH)
      .nullable()
      .optional(),
    server_about: z.string().max(SERVER_ABOUT_MAX_LENGTH).nullable().optional(),
    verification_context: z.string().max(VERIFICATION_CONTEXT_MAX_LENGTH).nullable().optional(),
    expected_topics: z.array(z.string()).optional(),
    detection_response_mode: detectionResponseModeSchema.optional(),
    message_detection_response_mode: detectionResponseModeSchema.nullable().optional(),
    join_detection_response_mode: detectionResponseModeSchema.nullable().optional(),
    observed_detection_notification_channel_id: z.string().nullable().optional(),
    moderation_queue_channel_id: z.string().nullable().optional(),
    observed_detection_min_confidence_threshold: z.number().min(0).max(100).optional(),
    observed_detection_notification_window_minutes: z.number().int().min(1).max(1440).optional(),
    automatic_detection_exempt_moderators: z.boolean().optional(),
    admin_case_open_requires_reason: z.boolean().optional(),
    observed_action_ban_requires_reason: z.boolean().optional(),
    moderator_ban_action_requires_reason: z.boolean().optional(),
    moderator_kick_action_requires_reason: z.boolean().optional(),
    moderator_ban_action_enabled: z.boolean().optional(),
    moderator_kick_action_enabled: z.boolean().optional(),
    observed_action_kick_enabled: z.boolean().optional(),
    message_detection_auto_kick_enabled: z.boolean().optional(),
    join_detection_auto_kick_enabled: z.boolean().optional(),
    report_intake_auto_kick_enabled: z.boolean().optional(),
    auto_kick_min_confidence_threshold: z
      .number()
      .min(AUTO_KICK_MIN_CONFIDENCE_THRESHOLD)
      .max(AUTO_KICK_MAX_CONFIDENCE_THRESHOLD)
      .optional(),
    manual_intake_enabled: z.boolean().optional(),
    manual_intake_role_id: z.string().nullable().optional(),
    manual_intake_grace_period_seconds: z
      .number()
      .int()
      .min(MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS)
      .max(MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS)
      .optional(),
    case_role_lockdown_enabled: z.boolean().optional(),
    case_role_lockdown_allowed_channel_ids: z.array(z.string()).optional(),
    case_role_lockdown_allowed_category_ids: z.array(z.string()).optional(),
    user_report_reason_required: z.boolean().optional(),
    user_report_external_response_mode: userReportExternalResponseModeSchema.optional(),
    report_intake_confirmed_response_mode: reportIntakeConfirmedResponseModeSchema.optional(),
    analytics_consent_level: analyticsConsentLevelSchema.optional(),
    case_review_reminders_enabled: z.boolean().optional(),
    case_review_reminder_stale_hours: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_HOURS)
      .max(CASE_REVIEW_REMINDER_MAX_HOURS)
      .optional(),
    case_review_reminder_repeat_hours: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_HOURS)
      .max(CASE_REVIEW_REMINDER_MAX_HOURS)
      .optional(),
    case_review_very_stale_days: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS)
      .max(CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS)
      .optional(),
    case_responder_role_ids: z.array(z.string()).optional(),
    case_responder_routing_mode: caseResponderRoutingModeSchema.optional(),
    case_responder_thread_member_cap: z
      .number()
      .int()
      .min(CASE_RESPONDER_MIN_THREAD_MEMBER_CAP)
      .max(CASE_RESPONDER_MAX_THREAD_MEMBER_CAP)
      .optional(),
    report_ai_triage_enabled: z.boolean().optional(),
    report_ai_analyze_text: z.boolean().optional(),
    report_ai_analyze_images: z.boolean().optional(),
    report_ai_max_action: reportAiMaxActionSchema.optional(),
    report_ai_open_case_threshold: z
      .number()
      .min(REPORT_AI_MIN_OPEN_CASE_THRESHOLD)
      .max(REPORT_AI_MAX_OPEN_CASE_THRESHOLD)
      .optional(),
    report_ai_restrict_threshold: z.number().min(0).max(1).optional(),
    report_ai_max_images: z
      .number()
      .int()
      .min(REPORT_AI_MIN_MAX_IMAGES)
      .max(REPORT_AI_MAX_MAX_IMAGES)
      .optional(),
    report_ai_max_image_bytes: z
      .number()
      .int()
      .min(REPORT_AI_MIN_MAX_IMAGE_BYTES)
      .max(REPORT_AI_MAX_MAX_IMAGE_BYTES)
      .optional(),
    role_gate_enabled: z.boolean().optional(),
    honeypot_role_id: z.string().nullable().optional(),
    member_access_role_id: z.string().nullable().optional(),
    honeypot_role_response_mode: detectionResponseModeSchema.optional(),
    role_quarantine_mode: roleQuarantineModeSchema.optional(),
    role_quarantine_exempt_role_ids: z.array(z.string()).optional(),
    account_quarantine_enabled: z.boolean().optional(),
    captcha_method: captchaMethodSchema.optional(),
    captcha_method_revision: z.number().int().min(0).max(2147483647).optional(),
    captcha_mode: captchaModeSchema.optional(),
    captcha_pass_action: captchaPassActionSchema.optional(),
    captcha_challenge_lifetime_hours: z
      .number()
      .int()
      .min(CAPTCHA_MIN_CHALLENGE_LIFETIME_HOURS)
      .max(CAPTCHA_MAX_CHALLENGE_LIFETIME_HOURS)
      .optional(),
    captcha_max_submissions: z
      .number()
      .int()
      .min(CAPTCHA_MIN_MAX_SUBMISSIONS)
      .max(CAPTCHA_MAX_MAX_SUBMISSIONS)
      .optional(),
    verification_ai_thread_analysis_enabled: z.boolean().optional(),
    verification_ai_thread_analysis_message_limit: z
      .number()
      .int()
      .min(VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT)
      .max(VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT)
      .optional(),
    verification_ai_max_action: verificationAiMaxActionSchema.optional(),
    verification_ai_restrict_threshold: z
      .number()
      .min(VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD)
      .max(VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD)
      .optional(),
    report_instructions_channel_id: z.string().nullable().optional(),
    report_instructions_message_channel_id: z.string().nullable().optional(),
    report_instructions_message_id: z.string().nullable().optional(),
    report_instructions_cleanup_channel_id: z.string().nullable().optional(),
    report_instructions_cleanup_message_id: z.string().nullable().optional(),
    report_instructions_pending_publication: z
      .object({
        channel_id: z.string(),
        after_message_id: z.string().nullable(),
      })
      .nullable()
      .optional(),
    message_deletion_enabled: z.boolean().optional(),
    message_deletion_source_message_enabled: z.boolean().optional(),
    message_deletion_watchlist_enabled: z.boolean().optional(),
    message_deletion_watchlist_disabled_default_ids:
      messageDeletionWatchlistDefaultIdsSchema.optional(),
    message_deletion_watchlist_custom_terms: messageDeletionWatchlistCustomTermsSchema.optional(),
  })
  .passthrough();

export const setupServerRecordSchema = z.object({
  guild_id: z.string(),
  case_role_id: z.string().nullable(),
  admin_channel_id: z.string().nullable(),
  verification_channel_id: z.string().nullable(),
  admin_notification_role_id: z.string().nullable(),
  heuristic_message_threshold: z.number().int(),
  heuristic_message_timeframe_seconds: z.number().int(),
  heuristic_suspicious_keywords: z.array(z.string()),
  created_at: z.string().nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
  settings: serverSettingsSchema,
  is_active: z.boolean(),
});

export const setupDiagnosticSeveritySchema = z.enum(['error', 'warning', 'ok']);
export const setupReadinessStatusSchema = z.enum([
  'not_installed',
  'needs_setup',
  'blocked',
  'ready',
]);

export interface DeriveSetupReadinessInput {
  readonly installed: boolean;
  readonly coreConfigured: boolean;
  readonly blockingErrorCount: number;
}

export function deriveSetupReadiness(input: DeriveSetupReadinessInput): SetupReadinessStatus {
  if (!input.installed) {
    return 'not_installed';
  }
  if (!input.coreConfigured) {
    return 'needs_setup';
  }
  return input.blockingErrorCount > 0 ? 'blocked' : 'ready';
}

export const setupChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: setupDiagnosticSeveritySchema,
  detail: z.string(),
});

export const setupDashboardSchema = z.object({
  guildId: z.string(),
  guildName: z.string(),
  readiness: setupReadinessStatusSchema,
  dataProvider: z.enum(['postgres', 'convex']),
  checkedAt: z.string(),
  checklist: z.array(setupChecklistItemSchema),
  server: setupServerRecordSchema.nullable(),
});

export const guildSetupUpdateSchema = z
  .object({
    guildId: z.string(),
    updatedBy: z.string().nullable().optional(),
    caseRoleId: z.string().nullable().optional(),
    adminChannelId: z.string().nullable().optional(),
    verificationChannelId: z.string().nullable().optional(),
    adminNotificationRoleId: z.string().nullable().optional(),
    observedNotificationChannelId: z.string().nullable().optional(),
    moderationQueueChannelId: z.string().nullable().optional(),
    reportInstructionsChannelId: z.string().nullable().optional(),
    heuristicMessageThreshold: z
      .number()
      .int()
      .min(HEURISTIC_MIN_MESSAGE_THRESHOLD)
      .max(HEURISTIC_MAX_MESSAGE_THRESHOLD)
      .optional(),
    heuristicMessageTimeframeSeconds: z
      .number()
      .int()
      .min(HEURISTIC_MIN_TIMEFRAME_SECONDS)
      .max(HEURISTIC_MAX_TIMEFRAME_SECONDS)
      .optional(),
    heuristicSuspiciousKeywords: z
      .array(z.string().trim().min(1))
      .max(HEURISTIC_MAX_KEYWORDS)
      .optional(),
    detectionResponseMode: detectionResponseModeSchema.optional(),
    messageDetectionResponseMode: detectionResponseModeSchema.nullable().optional(),
    joinDetectionResponseMode: detectionResponseModeSchema.nullable().optional(),
    observedDetectionMinConfidenceThreshold: z
      .number()
      .int()
      .min(OBSERVED_DETECTION_MIN_CONFIDENCE_THRESHOLD)
      .max(OBSERVED_DETECTION_MAX_CONFIDENCE_THRESHOLD)
      .optional(),
    observedDetectionNotificationWindowMinutes: z
      .number()
      .int()
      .min(OBSERVED_DETECTION_MIN_NOTIFICATION_WINDOW_MINUTES)
      .max(OBSERVED_DETECTION_MAX_NOTIFICATION_WINDOW_MINUTES)
      .optional(),
    automaticDetectionExemptModerators: z.boolean().optional(),
    adminCaseOpenRequiresReason: z.boolean().optional(),
    moderatorBanActionRequiresReason: z.boolean().optional(),
    moderatorKickActionRequiresReason: z.boolean().optional(),
    moderatorBanActionEnabled: z.boolean().optional(),
    moderatorKickActionEnabled: z.boolean().optional(),
    observedActionKickEnabled: z.boolean().optional(),
    messageDetectionAutoKickEnabled: z.boolean().optional(),
    joinDetectionAutoKickEnabled: z.boolean().optional(),
    reportIntakeAutoKickEnabled: z.boolean().optional(),
    autoKickMinConfidenceThreshold: z
      .number()
      .int()
      .min(AUTO_KICK_MIN_CONFIDENCE_THRESHOLD)
      .max(AUTO_KICK_MAX_CONFIDENCE_THRESHOLD)
      .optional(),
    manualIntakeEnabled: z.boolean().optional(),
    manualIntakeRoleId: z.string().nullable().optional(),
    manualIntakeGracePeriodSeconds: z
      .number()
      .int()
      .min(MANUAL_INTAKE_MIN_GRACE_PERIOD_SECONDS)
      .max(MANUAL_INTAKE_MAX_GRACE_PERIOD_SECONDS)
      .optional(),
    caseRoleLockdownAllowedChannelIds: z.array(z.string()).optional(),
    caseRoleLockdownAllowedCategoryIds: z.array(z.string()).optional(),
    userReportReasonRequired: z.boolean().optional(),
    userReportExternalResponseMode: userReportExternalResponseModeSchema.optional(),
    reportIntakeConfirmedResponseMode: reportIntakeConfirmedResponseModeSchema.optional(),
    analyticsConsentLevel: analyticsConsentLevelSchema.optional(),
    caseReviewRemindersEnabled: z.boolean().optional(),
    caseReviewReminderStaleHours: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_HOURS)
      .max(CASE_REVIEW_REMINDER_MAX_HOURS)
      .optional(),
    caseReviewReminderRepeatHours: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_HOURS)
      .max(CASE_REVIEW_REMINDER_MAX_HOURS)
      .optional(),
    caseReviewVeryStaleDays: z
      .number()
      .int()
      .min(CASE_REVIEW_REMINDER_MIN_VERY_STALE_DAYS)
      .max(CASE_REVIEW_REMINDER_MAX_VERY_STALE_DAYS)
      .optional(),
    reportAiTriageEnabled: z.boolean().optional(),
    reportAiAnalyzeText: z.boolean().optional(),
    reportAiAnalyzeImages: z.boolean().optional(),
    reportAiMaxAction: reportAiMaxActionSchema.optional(),
    reportAiOpenCaseThreshold: z
      .number()
      .min(REPORT_AI_MIN_OPEN_CASE_THRESHOLD)
      .max(REPORT_AI_MAX_OPEN_CASE_THRESHOLD)
      .optional(),
    reportAiMaxImages: z
      .number()
      .int()
      .min(REPORT_AI_MIN_MAX_IMAGES)
      .max(REPORT_AI_MAX_MAX_IMAGES)
      .optional(),
    reportAiMaxImageBytes: z
      .number()
      .int()
      .min(REPORT_AI_MIN_MAX_IMAGE_BYTES)
      .max(REPORT_AI_MAX_MAX_IMAGE_BYTES)
      .optional(),
    roleGateEnabled: z.boolean().optional(),
    honeypotRoleId: z.string().nullable().optional(),
    memberAccessRoleId: z.string().nullable().optional(),
    honeypotRoleResponseMode: detectionResponseModeSchema.optional(),
    roleQuarantineMode: roleQuarantineModeSchema.optional(),
    roleQuarantineExemptRoleIds: z.array(z.string()).optional(),
    accountQuarantineEnabled: z.boolean().optional(),
    captchaMethod: captchaMethodSchema.optional(),
    captchaMode: captchaModeSchema.optional(),
    captchaPassAction: captchaPassActionSchema.optional(),
    captchaChallengeLifetimeHours: z
      .number()
      .int()
      .min(CAPTCHA_MIN_CHALLENGE_LIFETIME_HOURS)
      .max(CAPTCHA_MAX_CHALLENGE_LIFETIME_HOURS)
      .optional(),
    captchaMaxSubmissions: z
      .number()
      .int()
      .min(CAPTCHA_MIN_MAX_SUBMISSIONS)
      .max(CAPTCHA_MAX_MAX_SUBMISSIONS)
      .optional(),
    verificationAnalysisEnabled: z.boolean().optional(),
    verificationAnalysisMessageLimit: z
      .number()
      .int()
      .min(VERIFICATION_ANALYSIS_MIN_MESSAGE_LIMIT)
      .max(VERIFICATION_ANALYSIS_MAX_MESSAGE_LIMIT)
      .optional(),
    verificationAnalysisMaxAction: verificationAiMaxActionSchema.optional(),
    verificationAnalysisRestrictThreshold: z
      .number()
      .min(VERIFICATION_ANALYSIS_MIN_RESTRICT_THRESHOLD)
      .max(VERIFICATION_ANALYSIS_MAX_RESTRICT_THRESHOLD)
      .optional(),
    verificationPromptTemplate: z
      .string()
      .max(VERIFICATION_PROMPT_TEMPLATE_MAX_LENGTH)
      .nullable()
      .optional(),
    serverAbout: z.string().max(SERVER_ABOUT_MAX_LENGTH).nullable().optional(),
    verificationContext: z.string().max(VERIFICATION_CONTEXT_MAX_LENGTH).nullable().optional(),
    expectedTopics: z.array(z.string()).optional(),
    caseResponderRoleIds: z.array(z.string()).optional(),
    caseResponderRoutingMode: caseResponderRoutingModeSchema.optional(),
    caseResponderThreadMemberCap: z
      .number()
      .int()
      .min(CASE_RESPONDER_MIN_THREAD_MEMBER_CAP)
      .max(CASE_RESPONDER_MAX_THREAD_MEMBER_CAP)
      .optional(),
    messageDeletionEnabled: z.boolean().optional(),
    messageDeletionSourceMessageEnabled: z.boolean().optional(),
    messageDeletionWatchlistEnabled: z.boolean().optional(),
    messageDeletionWatchlistDisabledDefaultIds: messageDeletionWatchlistDefaultIdsSchema.optional(),
    messageDeletionWatchlistCustomTerms: messageDeletionWatchlistCustomTermsSchema.optional(),
  })
  .superRefine((update, context) => {
    if (update.manualIntakeEnabled === true && update.manualIntakeRoleId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manual intake requires a trigger role before it can be enabled.',
        path: ['manualIntakeRoleId'],
      });
    }

    if (
      update.manualIntakeRoleId &&
      update.caseRoleId &&
      update.manualIntakeRoleId === update.caseRoleId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Manual intake trigger role must be separate from the case role.',
        path: ['manualIntakeRoleId'],
      });
    }
  });

export type DetectionResponseMode = z.infer<typeof detectionResponseModeSchema>;
export type UserReportExternalResponseMode = z.infer<typeof userReportExternalResponseModeSchema>;
export type AnalyticsConsentLevel = z.infer<typeof analyticsConsentLevelSchema>;
export type ReportIntakeConfirmedResponseMode = z.infer<
  typeof reportIntakeConfirmedResponseModeSchema
>;
export type ReportAiMaxAction = z.infer<typeof reportAiMaxActionSchema>;
export type CaseResponderRoutingMode = z.infer<typeof caseResponderRoutingModeSchema>;
export type VerificationAiMaxAction = z.infer<typeof verificationAiMaxActionSchema>;
export type RoleQuarantineMode = z.infer<typeof roleQuarantineModeSchema>;
export type SetupDiagnosticSeverity = z.infer<typeof setupDiagnosticSeveritySchema>;
export type SetupReadinessStatus = z.infer<typeof setupReadinessStatusSchema>;
export type ServerSettingsContract = z.infer<typeof serverSettingsSchema>;
export type SetupServerRecord = z.infer<typeof setupServerRecordSchema>;
export type SetupChecklistItem = z.infer<typeof setupChecklistItemSchema>;
export type SetupDashboard = z.infer<typeof setupDashboardSchema>;
export type GuildSetupUpdate = z.infer<typeof guildSetupUpdateSchema>;

// Mutation sections are closed; stored settings remain forward-compatible on reads.
export const settingsSectionSchemas = {
  roleGate: serverSettingsSchema
    .pick({
      role_gate_enabled: true,
      honeypot_role_id: true,
      member_access_role_id: true,
      honeypot_role_response_mode: true,
    })
    .strict(),
  roleQuarantine: serverSettingsSchema
    .pick({
      role_quarantine_mode: true,
      role_quarantine_exempt_role_ids: true,
      account_quarantine_enabled: true,
    })
    .strict(),
  queue: serverSettingsSchema.pick({ moderation_queue_channel_id: true }).strict(),
  manualIntake: serverSettingsSchema
    .pick({
      manual_intake_enabled: true,
      manual_intake_role_id: true,
      manual_intake_grace_period_seconds: true,
    })
    .strict(),
  caseStaff: serverSettingsSchema
    .pick({
      case_responder_role_ids: true,
      case_responder_routing_mode: true,
      case_responder_thread_member_cap: true,
    })
    .strict(),
  caseReview: serverSettingsSchema
    .pick({
      case_review_reminders_enabled: true,
      case_review_reminder_stale_hours: true,
      case_review_reminder_repeat_hours: true,
      case_review_very_stale_days: true,
    })
    .strict(),
  report: serverSettingsSchema
    .pick({
      report_instructions_channel_id: true,
      user_report_reason_required: true,
      user_report_external_response_mode: true,
      report_intake_confirmed_response_mode: true,
      report_ai_triage_enabled: true,
      report_ai_analyze_text: true,
      report_ai_analyze_images: true,
      report_ai_max_action: true,
      report_ai_open_case_threshold: true,
      report_ai_restrict_threshold: true,
      report_ai_max_images: true,
      report_ai_max_image_bytes: true,
    })
    .strict(),
  analytics: serverSettingsSchema.pick({ analytics_consent_level: true }).strict(),
  verification: serverSettingsSchema
    .pick({
      verification_prompt_template: true,
      verification_context: true,
      captcha_method: true,
      captcha_mode: true,
      captcha_pass_action: true,
      captcha_challenge_lifetime_hours: true,
      captcha_max_submissions: true,
      verification_ai_thread_analysis_enabled: true,
      verification_ai_thread_analysis_message_limit: true,
      verification_ai_max_action: true,
      verification_ai_restrict_threshold: true,
      server_about: true,
      expected_topics: true,
    })
    .strict(),
  lockdown: serverSettingsSchema
    .pick({
      case_role_lockdown_enabled: true,
      case_role_lockdown_allowed_channel_ids: true,
      case_role_lockdown_allowed_category_ids: true,
    })
    .strict(),
  detection: serverSettingsSchema
    .pick({
      min_confidence_threshold: true,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: true,
      message_retention_days: true,
      detection_retention_days: true,
      detection_response_mode: true,
      message_detection_response_mode: true,
      join_detection_response_mode: true,
      observed_detection_notification_channel_id: true,
      observed_detection_min_confidence_threshold: true,
      observed_detection_notification_window_minutes: true,
      automatic_detection_exempt_moderators: true,
      admin_case_open_requires_reason: true,
      observed_action_ban_requires_reason: true,
      moderator_ban_action_requires_reason: true,
      moderator_kick_action_requires_reason: true,
      moderator_ban_action_enabled: true,
      moderator_kick_action_enabled: true,
      observed_action_kick_enabled: true,
      message_detection_auto_kick_enabled: true,
      join_detection_auto_kick_enabled: true,
      report_intake_auto_kick_enabled: true,
      auto_kick_min_confidence_threshold: true,
      message_deletion_enabled: true,
      message_deletion_source_message_enabled: true,
      message_deletion_watchlist_enabled: true,
      message_deletion_watchlist_disabled_default_ids: true,
      message_deletion_watchlist_custom_terms: true,
    })
    .strict(),
};
export type SettingsSection = keyof typeof settingsSectionSchemas;
export type SettingsChanges = {
  [S in SettingsSection]: z.infer<(typeof settingsSectionSchemas)[S]>;
}[SettingsSection];

export function normalizeOptionalId(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildSetupSettingsPatch(update: GuildSetupUpdate): SettingsChanges {
  return Object.fromEntries(
    Object.entries({
      observed_detection_notification_channel_id: normalizeOptionalId(
        update.observedNotificationChannelId
      ),
      moderation_queue_channel_id: normalizeOptionalId(update.moderationQueueChannelId),
      report_instructions_channel_id: normalizeOptionalId(update.reportInstructionsChannelId),
      detection_response_mode: update.detectionResponseMode,
      message_detection_response_mode: update.messageDetectionResponseMode,
      join_detection_response_mode: update.joinDetectionResponseMode,
      observed_detection_min_confidence_threshold: update.observedDetectionMinConfidenceThreshold,
      observed_detection_notification_window_minutes:
        update.observedDetectionNotificationWindowMinutes,
      automatic_detection_exempt_moderators: update.automaticDetectionExemptModerators,
      admin_case_open_requires_reason: update.adminCaseOpenRequiresReason,
      moderator_ban_action_requires_reason: update.moderatorBanActionRequiresReason,
      moderator_kick_action_requires_reason: update.moderatorKickActionRequiresReason,
      moderator_ban_action_enabled: update.moderatorBanActionEnabled,
      moderator_kick_action_enabled: update.moderatorKickActionEnabled,
      observed_action_kick_enabled: update.observedActionKickEnabled,
      message_detection_auto_kick_enabled: update.messageDetectionAutoKickEnabled,
      join_detection_auto_kick_enabled: update.joinDetectionAutoKickEnabled,
      report_intake_auto_kick_enabled: update.reportIntakeAutoKickEnabled,
      auto_kick_min_confidence_threshold: update.autoKickMinConfidenceThreshold,
      manual_intake_enabled: update.manualIntakeEnabled,
      manual_intake_role_id: normalizeOptionalId(update.manualIntakeRoleId),
      manual_intake_grace_period_seconds: update.manualIntakeGracePeriodSeconds,
      case_role_lockdown_allowed_channel_ids: update.caseRoleLockdownAllowedChannelIds,
      case_role_lockdown_allowed_category_ids: update.caseRoleLockdownAllowedCategoryIds,
      user_report_reason_required: update.userReportReasonRequired,
      user_report_external_response_mode: update.userReportExternalResponseMode,
      report_intake_confirmed_response_mode: update.reportIntakeConfirmedResponseMode,
      analytics_consent_level: update.analyticsConsentLevel,
      case_review_reminders_enabled: update.caseReviewRemindersEnabled,
      case_review_reminder_stale_hours: update.caseReviewReminderStaleHours,
      case_review_reminder_repeat_hours: update.caseReviewReminderRepeatHours,
      case_review_very_stale_days: update.caseReviewVeryStaleDays,
      report_ai_triage_enabled: update.reportAiTriageEnabled,
      report_ai_analyze_text: update.reportAiAnalyzeText,
      report_ai_analyze_images: update.reportAiAnalyzeImages,
      report_ai_max_action: update.reportAiMaxAction,
      report_ai_open_case_threshold: update.reportAiOpenCaseThreshold,
      report_ai_max_images: update.reportAiMaxImages,
      report_ai_max_image_bytes: update.reportAiMaxImageBytes,
      role_gate_enabled: update.roleGateEnabled,
      honeypot_role_id: normalizeOptionalId(update.honeypotRoleId),
      member_access_role_id: normalizeOptionalId(update.memberAccessRoleId),
      honeypot_role_response_mode: update.honeypotRoleResponseMode,
      role_quarantine_mode: update.roleQuarantineMode,
      role_quarantine_exempt_role_ids: update.roleQuarantineExemptRoleIds,
      account_quarantine_enabled: update.accountQuarantineEnabled,
      captcha_method:
        update.captchaMethod ??
        (update.captchaMode === undefined
          ? undefined
          : getEffectiveCaptchaMethod({ captcha_mode: update.captchaMode })),
      captcha_mode: update.captchaMode,
      captcha_pass_action: update.captchaPassAction,
      captcha_challenge_lifetime_hours: update.captchaChallengeLifetimeHours,
      captcha_max_submissions: update.captchaMaxSubmissions,
      verification_ai_thread_analysis_enabled: update.verificationAnalysisEnabled,
      verification_ai_thread_analysis_message_limit: update.verificationAnalysisMessageLimit,
      verification_ai_max_action: update.verificationAnalysisMaxAction,
      verification_ai_restrict_threshold: update.verificationAnalysisRestrictThreshold,
      verification_prompt_template: update.verificationPromptTemplate,
      server_about: update.serverAbout,
      verification_context: update.verificationContext,
      expected_topics: update.expectedTopics,
      case_responder_role_ids: update.caseResponderRoleIds,
      case_responder_routing_mode: update.caseResponderRoutingMode,
      case_responder_thread_member_cap: update.caseResponderThreadMemberCap,
      message_deletion_enabled: update.messageDeletionEnabled,
      message_deletion_source_message_enabled: update.messageDeletionSourceMessageEnabled,
      message_deletion_watchlist_enabled: update.messageDeletionWatchlistEnabled,
      message_deletion_watchlist_disabled_default_ids:
        update.messageDeletionWatchlistDisabledDefaultIds,
      message_deletion_watchlist_custom_terms: update.messageDeletionWatchlistCustomTerms,
    }).filter((entry) => entry[1] !== undefined)
  );
}

export interface CaptchaProviderConfiguration {
  readonly siteKeyConfigured: boolean;
  readonly secretKeyConfigured: boolean;
  readonly bindingSecretConfigured: boolean;
  readonly expectedHostname: string | undefined;
  readonly publicUrl: string | undefined;
}
export function setupCaptchaProviderIssues(configuration: CaptchaProviderConfiguration): string[] {
  const issues: string[] = [];
  if (!configuration.siteKeyConfigured) issues.push('NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  if (!configuration.secretKeyConfigured) issues.push('TURNSTILE_SECRET_KEY');
  if (!configuration.expectedHostname) issues.push('TURNSTILE_EXPECTED_HOSTNAME');
  if (!configuration.bindingSecretConfigured) issues.push('DRASIL_CAPTCHA_BINDING_SECRET');
  if (!configuration.publicUrl) return [...issues, 'NEXT_PUBLIC_APP_URL or DRASIL_WEB_PUBLIC_URL'];
  try {
    const url = new URL(configuration.publicUrl);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      issues.push('public web URL must be a bare origin');
    if (url.protocol !== 'https:' && url.hostname !== 'localhost')
      issues.push('public web URL must use HTTPS');
    if (
      configuration.expectedHostname &&
      url.hostname.toLowerCase() !== configuration.expectedHostname.toLowerCase()
    )
      issues.push('TURNSTILE_EXPECTED_HOSTNAME must match the public web URL hostname');
  } catch {
    issues.push('public web URL must be a valid URL');
  }
  return issues;
}
