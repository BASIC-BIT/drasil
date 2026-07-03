import { z } from 'zod';

const activeDetectionResponseModeSchema = z.enum(['off', 'record_only', 'notify_only', 'restrict']);

export const detectionResponseModeSchema = z.preprocess(
  (value) => (value === 'open_case' ? 'notify_only' : value),
  activeDetectionResponseModeSchema
);

export const userReportExternalResponseModeSchema = z.enum(['off', 'notify_only', 'open_case']);
export const analyticsConsentLevelSchema = z.enum(['off', 'anonymous', 'full']);
export const reportAiMaxActionSchema = z.enum(['off', 'hints', 'open_case', 'restrict']);
export const caseResponderRoutingModeSchema = z.enum(['off', 'ping_only', 'ping_and_add_members']);
export const MESSAGE_DELETION_MAX_CUSTOM_WATCHLIST_TERMS = 25;
export const MESSAGE_DELETION_CUSTOM_WATCHLIST_TERM_MAX_LENGTH = 120;
export const MESSAGE_DELETION_MAX_DISABLED_DEFAULT_IDS = 10;

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
    verification_prompt_template: z.string().optional(),
    server_about: z.string().optional(),
    verification_context: z.string().optional(),
    expected_topics: z.array(z.string()).optional(),
    detection_response_mode: detectionResponseModeSchema.optional(),
    message_detection_response_mode: detectionResponseModeSchema.nullable().optional(),
    join_detection_response_mode: detectionResponseModeSchema.nullable().optional(),
    observed_detection_notification_channel_id: z.string().nullable().optional(),
    observed_detection_min_confidence_threshold: z.number().min(0).max(100).optional(),
    observed_detection_notification_window_minutes: z.number().int().min(1).max(1440).optional(),
    automatic_detection_exempt_moderators: z.boolean().optional(),
    observed_action_ban_requires_reason: z.boolean().optional(),
    moderator_ban_action_enabled: z.boolean().optional(),
    user_report_reason_required: z.boolean().optional(),
    user_report_external_response_mode: userReportExternalResponseModeSchema.optional(),
    analytics_consent_level: analyticsConsentLevelSchema.optional(),
    case_responder_role_ids: z.array(z.string()).optional(),
    case_responder_routing_mode: caseResponderRoutingModeSchema.optional(),
    case_responder_thread_member_cap: z.number().int().min(1).max(100).optional(),
    report_ai_triage_enabled: z.boolean().optional(),
    report_ai_analyze_text: z.boolean().optional(),
    report_ai_analyze_images: z.boolean().optional(),
    report_ai_max_action: reportAiMaxActionSchema.optional(),
    report_ai_open_case_threshold: z.number().min(0).max(1).optional(),
    report_ai_restrict_threshold: z.number().min(0).max(1).optional(),
    report_ai_max_images: z.number().int().min(0).max(8).optional(),
    report_ai_max_image_bytes: z.number().int().min(1).optional(),
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

export const guildSetupUpdateSchema = z.object({
  guildId: z.string(),
  updatedBy: z.string().nullable().optional(),
  caseRoleId: z.string().nullable().optional(),
  adminChannelId: z.string().nullable().optional(),
  verificationChannelId: z.string().nullable().optional(),
  adminNotificationRoleId: z.string().nullable().optional(),
  observedNotificationChannelId: z.string().nullable().optional(),
  reportInstructionsChannelId: z.string().nullable().optional(),
  detectionResponseMode: detectionResponseModeSchema.optional(),
  messageDetectionResponseMode: detectionResponseModeSchema.nullable().optional(),
  joinDetectionResponseMode: detectionResponseModeSchema.nullable().optional(),
  userReportReasonRequired: z.boolean().optional(),
  userReportExternalResponseMode: userReportExternalResponseModeSchema.optional(),
  analyticsConsentLevel: analyticsConsentLevelSchema.optional(),
  reportAiTriageEnabled: z.boolean().optional(),
  reportAiMaxAction: reportAiMaxActionSchema.optional(),
  caseResponderRoleIds: z.array(z.string()).optional(),
  caseResponderRoutingMode: caseResponderRoutingModeSchema.optional(),
  messageDeletionEnabled: z.boolean().optional(),
  messageDeletionSourceMessageEnabled: z.boolean().optional(),
  messageDeletionWatchlistEnabled: z.boolean().optional(),
  messageDeletionWatchlistDisabledDefaultIds: messageDeletionWatchlistDefaultIdsSchema.optional(),
  messageDeletionWatchlistCustomTerms: messageDeletionWatchlistCustomTermsSchema.optional(),
});

export type DetectionResponseMode = z.infer<typeof detectionResponseModeSchema>;
export type UserReportExternalResponseMode = z.infer<typeof userReportExternalResponseModeSchema>;
export type AnalyticsConsentLevel = z.infer<typeof analyticsConsentLevelSchema>;
export type ReportAiMaxAction = z.infer<typeof reportAiMaxActionSchema>;
export type CaseResponderRoutingMode = z.infer<typeof caseResponderRoutingModeSchema>;
export type SetupDiagnosticSeverity = z.infer<typeof setupDiagnosticSeveritySchema>;
export type ServerSettingsContract = z.infer<typeof serverSettingsSchema>;
export type SetupServerRecord = z.infer<typeof setupServerRecordSchema>;
export type SetupChecklistItem = z.infer<typeof setupChecklistItemSchema>;
export type SetupDashboard = z.infer<typeof setupDashboardSchema>;
export type GuildSetupUpdate = z.infer<typeof guildSetupUpdateSchema>;
