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
    report_instructions_message_id: z.string().nullable().optional(),
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

export const setupChecklistItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: setupDiagnosticSeveritySchema,
  detail: z.string(),
});

export const setupDashboardSchema = z.object({
  guildId: z.string(),
  guildName: z.string(),
  configured: z.boolean(),
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
export type ServerSettingsContract = z.infer<typeof serverSettingsSchema>;
export type SetupServerRecord = z.infer<typeof setupServerRecordSchema>;
export type SetupChecklistItem = z.infer<typeof setupChecklistItemSchema>;
export type SetupDashboard = z.infer<typeof setupDashboardSchema>;
export type GuildSetupUpdate = z.infer<typeof guildSetupUpdateSchema>;
