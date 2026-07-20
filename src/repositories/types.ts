import { Prisma } from '../db/prisma';
/**
 * TypeScript types for database entities
 */

/**
 * Server/Guild configuration entity
 */
export interface Server {
  guild_id: string; // Discord guild/server ID (primary key)
  case_role_id: string | null; // ID of role applied while a user has an active case
  admin_channel_id: string | null; // ID of admin notification channel
  verification_channel_id: string | null; // ID of verification channel
  admin_notification_role_id: string | null; // ID of role to ping for notifications
  heuristic_message_threshold: number; // Number of messages before triggering frequency detection
  heuristic_message_timeframe_seconds: number; // Timeframe in seconds for message threshold
  heuristic_suspicious_keywords: string[]; // Keywords that trigger suspicious content detection
  created_at: string | null; // Creation timestamp
  updated_at: string | null; // Last update timestamp
  updated_by: string | null; // Discord ID of who last updated the record
  settings: ServerSettings; // JSON blob for flexible settings
  is_active: boolean; // Whether the bot is active in this server
}

/**
 * Flexible server settings stored as JSON
 */
export interface ServerSettings {
  min_confidence_threshold?: number; // Minimum confidence for GPT detection
  use_gpt_on_join?: boolean; // Whether to use GPT for join verification
  gpt_message_check_count?: number; // Number of messages to check with GPT
  message_retention_days?: number; // Days to retain message history
  detection_retention_days?: number; // Days to retain detection history
  verification_prompt_template?: string; // Custom verification thread prompt template
  server_about?: string; // Short description of the server/community for GPT context
  verification_context?: string; // Moderator-provided guidance for what legitimate users know
  expected_topics?: string[]; // Topics, keywords, or links expected from legitimate users
  verification_ai_thread_analysis_enabled?: boolean; // Whether to analyze replies in verification threads
  verification_ai_thread_analysis_message_limit?: number; // Max flagged-user thread messages to analyze
  verification_ai_max_action?: 'off' | 'hints' | 'restrict';
  verification_ai_restrict_threshold?: number;
  detection_response_mode?: 'off' | 'record_only' | 'notify_only' | 'restrict';
  message_detection_response_mode?: 'off' | 'record_only' | 'notify_only' | 'restrict' | null;
  join_detection_response_mode?: 'off' | 'record_only' | 'notify_only' | 'restrict' | null;
  observed_detection_notification_channel_id?: string | null;
  observed_detection_min_confidence_threshold?: number;
  observed_detection_notification_window_minutes?: number;
  automatic_detection_exempt_moderators?: boolean;
  admin_case_open_requires_reason?: boolean;
  moderator_ban_action_requires_reason?: boolean;
  moderator_kick_action_requires_reason?: boolean;
  moderator_ban_action_enabled?: boolean;
  moderator_kick_action_enabled?: boolean;
  observed_action_kick_enabled?: boolean;
  message_detection_auto_kick_enabled?: boolean;
  join_detection_auto_kick_enabled?: boolean;
  report_intake_auto_kick_enabled?: boolean;
  auto_kick_min_confidence_threshold?: number;
  user_report_reason_required?: boolean;
  user_report_external_response_mode?: 'off' | 'notify_only' | 'open_case';
  analytics_consent_level?: 'off' | 'anonymous' | 'full';
  case_responder_role_ids?: string[];
  case_responder_routing_mode?: 'off' | 'ping_only' | 'ping_and_add_members';
  case_responder_thread_member_cap?: number;
  report_ai_triage_enabled?: boolean;
  report_ai_analyze_text?: boolean;
  report_ai_analyze_images?: boolean;
  report_ai_max_action?: 'off' | 'hints' | 'open_case';
  report_ai_open_case_threshold?: number;
  report_ai_max_images?: number;
  report_ai_max_image_bytes?: number;
  report_intake_agent_enabled?: boolean;
  report_intake_agent_debounce_ms?: number;
  report_intake_agent_min_interval_ms?: number;
  report_intake_confirmed_response_mode?: 'observed_alert' | 'open_case' | 'kick';
  manual_intake_enabled?: boolean;
  manual_intake_role_id?: string | null;
  manual_intake_grace_period_seconds?: number;
  report_instructions_channel_id?: string | null;
  report_instructions_message_id?: string | null;
  case_role_lockdown_enabled?: boolean;
  case_role_lockdown_allowed_channel_ids?: string[];
  case_role_lockdown_allowed_category_ids?: string[];
  role_quarantine_mode?: 'off' | 'on' | 'audit_only';
  role_quarantine_exempt_role_ids?: string[];
  role_gate_enabled?: boolean;
  honeypot_role_id?: string | null;
  member_access_role_id?: string | null;
  honeypot_role_response_mode?: 'off' | 'record_only' | 'notify_only' | 'restrict';
  case_review_reminders_enabled?: boolean;
  case_review_reminder_stale_hours?: number;
  case_review_reminder_repeat_hours?: number;
  case_review_very_stale_days?: number;
  case_review_digest_last_sent_at?: string | null;
  admin_reminder_digest_last_sent_at?: string | null;
  pending_screening_alerts_enabled?: boolean;
  pending_screening_long_pending_days?: number;
  moderation_queue_channel_id?: string | null;
  message_deletion_enabled?: boolean;
  message_deletion_source_message_enabled?: boolean;
  message_deletion_watchlist_enabled?: boolean;
  message_deletion_watchlist_disabled_default_ids?: string[];
  message_deletion_watchlist_custom_terms?: string[];
  setup_nudge_last_attempt_at?: string | null;
  setup_nudge_last_recipient_id?: string | null;
  setup_nudge_last_result?: 'sent' | 'dm_failed' | 'no_recipient' | null;
  setup_nudge_last_source?: 'audit_log_installer' | 'owner' | null;
  setup_warning_last_fingerprint?: string | null;
}

export interface GlobalMessageWatchlistEntry {
  id: string;
  label: string;
  term: string;
  requiresLinkOrVideo: boolean;
}

/**
 * User entity across servers
 */
export interface User {
  discord_id: string; // Discord user ID (primary key)
  username: string | null; // Discord username
  created_at: string | null; // Creation timestamp
  updated_at: string | null; // Last update timestamp
  created_by: string | null; // Discord ID of who created the record
  updated_by: string | null; // Discord ID of who last updated the record
  global_reputation_score?: number; // Cross-server reputation score (-1.0 to 1.0)
  account_created_at: string | null; // When the Discord account was created
  metadata?: Record<string, unknown>; // Additional metadata
  suspicious_server_count?: number; // Number of servers where the user has been flagged
  first_flagged_at: string | null; // When the user was first flagged in any server
}

/**
 * Server member (user in a specific server)
 */
export interface ServerMember {
  server_id: string; // Discord server ID (primary key with user_id)
  user_id: string; // Discord user ID (primary key with server_id)
  join_date: Date | null; // When the user joined the server (Use Date type)
  reputation_score?: number; // Server-specific reputation score (-1.0 to 1.0)
  case_role_active?: boolean; // Whether the user currently has the case role
  last_verified_at: string | null; // Last time user was verified
  last_message_at: string | null; // Last time user sent a message
  message_count?: number; // Total message count in server
  verification_status?: VerificationStatus; // Add missing status field (use enum from below)
  last_status_change: Date | null; // When the status was last changed (Use Date type)
  discord_member_pending: boolean; // Discord membership screening/onboarding pending state
  discord_member_pending_since: Date | null; // When Discord pending screening was first observed
  discord_member_pending_cleared_at: Date | null; // Last time Discord pending screening cleared
  discord_member_pending_last_checked_at: Date | null; // Last time Discord pending state was observed
  discord_member_pending_digest_sent_at: Date | null; // Last one-time digest notification for this pending episode
  // Remove fields not present in the database schema
  // case_role_reason: string | null;
  // moderator_id: string | null;
  created_by: string | null; // Discord ID of who created the record
  updated_by: string | null; // Discord ID of who last updated the record
}

export enum DetectionType {
  MESSAGE_FREQUENCY = 'message_frequency',
  SUSPICIOUS_CONTENT = 'suspicious_content',
  GPT_ANALYSIS = 'gpt_analysis',
  NEW_ACCOUNT = 'new_account',
  REJOIN_AFTER_KICK = 'rejoin_after_kick',
  PATTERN_MATCH = 'pattern_match',
  USER_REPORT = 'user_report',
  ADMIN_CASE = 'admin_case',
  ADMIN_FLAG = 'admin_flag',
  ROLE_INTAKE = 'role_intake',
  HONEYPOT_ROLE = 'honeypot_role',
}

/**
 * Represents a spam detection event
 */
export interface DetectionEvent {
  id: string; // UUID for the event
  server_id: string | null; // Discord server ID, null for user-installed app reports
  user_id: string; // Discord user ID
  thread_id: string | null; // Discord thread ID if applicable
  message_id: string | null; // Discord message ID
  channel_id: string | null; // Discord channel ID where the message was sent
  detection_type: DetectionType;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  detected_at: string | Date;
  latest_verification_event_id: string | null;
  metadata?: Record<string, unknown>;
  admin_actions?: AdminAction[];
}

export enum VerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  BANNED = 'banned',
  KICKED = 'kicked',
  CLOSED_NO_ACTION = 'closed_no_action',
}

export enum AdminActionType {
  VERIFY = 'verify',
  REJECT = 'reject',
  BAN = 'ban',
  KICK = 'kick',
  CLOSE_NO_ACTION = 'close_no_action',
  REOPEN = 'reopen',
  CREATE_THREAD = 'create_thread',
  OPEN_CASE = 'open_case',
  RESTRICT = 'restrict',
  LIFT_RESTRICTION = 'lift_restriction',
  DISMISS = 'dismiss',
  FALSE_POSITIVE = 'false_positive',
  UNDO_OBSERVED_ACTION = 'undo_observed_action',
  ROLE_GATE_CLEANUP = 'role_gate_cleanup',
}

export enum ModerationOutcomeSource {
  DRASIL = 'drasil',
  NATIVE_DISCORD = 'native_discord',
  EXTERNAL_BOT = 'external_bot',
  UNKNOWN_EXTERNAL = 'unknown_external',
  MIGRATION_OR_SYNC = 'migration_or_sync',
}

export enum ModerationOutcomeType {
  RESTRICTED = 'restricted',
  VERIFIED = 'verified',
  BANNED = 'banned',
  KICKED = 'kicked',
  CLOSED_NO_ACTION = 'closed_no_action',
  MEMBER_LEFT = 'member_left',
}

export enum ModerationQueueItemType {
  CASE_MIRROR = 'case_mirror',
  OBSERVED_ALERT_MIRROR = 'observed_alert_mirror',
  SUPPORT_THREAD_ATTENTION = 'support_thread_attention',
  REPORT_THREAD_ATTENTION = 'report_thread_attention',
  PENDING_SCREENING_MEMBER = 'pending_screening_member',
}

export enum ModerationActionRequestType {
  OPEN_CASE_FROM_OBSERVED_DETECTION = 'open_case_from_observed_detection',
  OPEN_ADMIN_CASE = 'open_admin_case',
  MANUAL_FLAG_USER = 'manual_flag_user',
  SUBMIT_USER_REPORT = 'submit_user_report',
  START_REPORT_INTAKE = 'start_report_intake',
  CLOSE_REPORT_INTAKE = 'close_report_intake',
  DISMISS_OBSERVED_DETECTION = 'dismiss_observed_detection',
  MARK_OBSERVED_DETECTION_FALSE_POSITIVE = 'mark_observed_detection_false_positive',
  UNDO_OBSERVED_DETECTION_ACTION = 'undo_observed_detection_action',
  KICK_OBSERVED_DETECTION = 'kick_observed_detection',
  BAN_OBSERVED_DETECTION = 'ban_observed_detection',
  IGNORE_DETECTION_ACCOUNTING = 'ignore_detection_accounting',
  RESTORE_DETECTION_ACCOUNTING = 'restore_detection_accounting',
  VERIFY_CASE_USER = 'verify_case_user',
  CLOSE_CASE_NO_ACTION = 'close_case_no_action',
  KICK_CASE_USER = 'kick_case_user',
  BAN_CASE_USER = 'ban_case_user',
  BAN_CASE_USER_BY_ID = 'ban_case_user_by_id',
  REPAIR_ACTIVE_CASE = 'repair_active_case',
  REOPEN_CASE = 'reopen_case',
  REFRESH_CASE_NOTIFICATION = 'refresh_case_notification',
  SYNC_MODERATION_QUEUE = 'sync_moderation_queue',
  CLEAR_MODERATION_QUEUE = 'clear_moderation_queue',
  CLOSE_RESOLVED_CASE_THREADS = 'close_resolved_case_threads',
  AUDIT_CASE_ROLE_LOCKDOWN = 'audit_case_role_lockdown',
  APPLY_CASE_ROLE_LOCKDOWN = 'apply_case_role_lockdown',
  INTAKE_ROLE_MEMBERS = 'intake_role_members',
  SYNC_EXISTING_BAN = 'sync_existing_ban',
  COMPLETE_SETUP_VERIFICATION = 'complete_setup_verification',
  UPSERT_REPORT_INSTRUCTIONS = 'upsert_report_instructions',
  PREVIEW_CASE_MESSAGE_DELETION = 'preview_case_message_deletion',
  EXECUTE_CASE_MESSAGE_DELETION = 'execute_case_message_deletion',
  BAN_CASE_USER_WITH_MESSAGE_CLEANUP = 'ban_case_user_with_message_cleanup',
}

export enum ModerationActionRequestStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum MessageDeletionJobMode {
  DELETE_ONLY = 'delete_only',
  BAN_WITH_CLEANUP = 'ban_with_cleanup',
}

export enum MessageDeletionBanStatus {
  NOT_REQUESTED = 'not_requested',
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export enum MessageDeletionCaseFinalizationStatus {
  NOT_APPLICABLE = 'not_applicable',
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export enum MessageDeletionScope {
  SOURCE_MESSAGE = 'source_message',
  LAST_HOUR = 'last_hour',
  LAST_DAY = 'last_day',
  LAST_7_DAYS = 'last_7_days',
}

export enum MessageDeletionJobStatus {
  QUEUED = 'queued',
  DISCOVERING = 'discovering',
  READY = 'ready',
  EXECUTING = 'executing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum MessageDeletionCoverage {
  READY = 'ready',
  PARTIAL = 'partial',
  INDEXING = 'indexing',
  DENIED = 'denied',
  UNAVAILABLE = 'unavailable',
  TOO_MANY = 'too_many',
}

export enum MessageDeletionDiscoverySource {
  SOURCE_MESSAGE = 'source_message',
  DISCORD_SEARCH = 'discord_search',
  MESSAGE_CONTEXT = 'message_context',
}

export enum MessageDeletionEvidenceStatus {
  PENDING = 'pending',
  PRESERVED = 'preserved',
  FAILED = 'failed',
}

export enum MessageDeletionItemStatus {
  PENDING = 'pending',
  DELETED = 'deleted',
  ALREADY_MISSING = 'already_missing',
  CHANGED_SINCE_PREVIEW = 'changed_since_preview',
  EVIDENCE_FAILED = 'evidence_failed',
  DELETE_FAILED = 'delete_failed',
  PERMISSION_DENIED = 'permission_denied',
}

export enum RoleQuarantineSnapshotStatus {
  ACTIVE = 'active',
  RESTORED = 'restored',
  ABANDONED = 'abandoned',
}

export interface RoleQuarantineRoleDetail {
  role_id: string;
  role_name?: string;
  reason: string;
}

export interface RoleQuarantineSnapshot {
  id: string;
  server_id: string;
  user_id: string;
  verification_event_id: string | null;
  status: RoleQuarantineSnapshotStatus;
  mode: string;
  original_role_ids: string[];
  planned_role_ids: string[];
  removed_role_ids: string[];
  restored_role_ids: string[];
  skipped_roles: Prisma.JsonValue | null;
  failed_removals: Prisma.JsonValue | null;
  failed_restores: Prisma.JsonValue | null;
  created_at: Date | null;
  updated_at: Date | null;
  restored_at: Date | null;
  restored_by: string | null;
  metadata: Prisma.JsonValue | null;
}

export interface RoleQuarantineSnapshotCreate {
  serverId: string;
  userId: string;
  verificationEventId?: string | null;
  mode: string;
  originalRoleIds: string[];
  plannedRoleIds: string[];
  removedRoleIds?: string[];
  restoredRoleIds?: string[];
  skippedRoles?: Prisma.JsonValue | null;
  failedRemovals?: Prisma.JsonValue | null;
  failedRestores?: Prisma.JsonValue | null;
  metadata?: Prisma.JsonValue | null;
}

export interface RoleQuarantineSnapshotUpdate {
  status?: RoleQuarantineSnapshotStatus;
  removedRoleIds?: string[];
  restoredRoleIds?: string[];
  skippedRoles?: Prisma.JsonValue | null;
  failedRemovals?: Prisma.JsonValue | null;
  failedRestores?: Prisma.JsonValue | null;
  restoredAt?: Date | null;
  restoredBy?: string | null;
  metadata?: Prisma.JsonValue | null;
}

export interface VerificationEvent {
  id: string;
  server_id: string;
  user_id: string;
  detection_event_id: string | null;
  thread_id: string | null;
  private_evidence_thread_id: string | null;
  notification_channel_id: string | null;
  notification_message_id: string | null;
  status: VerificationStatus;
  created_at: Date; // Use Date type
  updated_at: Date; // Use Date type
  resolved_at: Date | null; // Use Date type
  resolved_by: string | null;
  notes: string | null;
  metadata: Prisma.JsonValue | null; // Align with Prisma JSON type
}

export interface AdminAction {
  id: string;
  server_id: string | null;
  user_id: string | null;
  admin_id: string;
  verification_event_id: string | null;
  detection_event_id: string | null;
  action_type: AdminActionType;
  action_at: Date; // Use Date type
  previous_status: VerificationStatus | null;
  new_status: VerificationStatus | null;
  notes: string | null;
  metadata: Prisma.JsonValue | null; // Align with Prisma JSON type
}

export interface ModerationOutcome {
  id: string;
  server_id: string;
  user_id: string;
  detection_event_id: string | null;
  verification_event_id: string | null;
  outcome_type: ModerationOutcomeType;
  source: ModerationOutcomeSource;
  actor_id: string | null;
  reason: string | null;
  occurred_at: Date | null;
  created_at: Date | null;
  metadata: Prisma.JsonValue | null;
}

export interface ModerationQueueItem {
  id: string;
  server_id: string;
  user_id: string;
  item_type: ModerationQueueItemType;
  verification_event_id: string | null;
  detection_event_id: string | null;
  report_intake_id: string | null;
  source_thread_id: string | null;
  queue_channel_id: string | null;
  queue_message_id: string | null;
  last_source_message_id: string | null;
  last_notified_at: Date | null;
  created_at: Date | null;
  updated_at: Date | null;
  metadata: Prisma.JsonValue | null;
}

export interface ModerationQueueItemUpsert {
  serverId: string;
  userId: string;
  itemType: ModerationQueueItemType;
  verificationEventId?: string | null;
  detectionEventId?: string | null;
  reportIntakeId?: string | null;
  sourceThreadId?: string | null;
  queueChannelId?: string | null;
  queueMessageId?: string | null;
  lastSourceMessageId?: string | null;
  lastNotifiedAt?: Date | null;
  metadata?: Prisma.JsonValue | null;
}

export interface ModerationActionRequest {
  id: string;
  server_id: string;
  action_type: ModerationActionRequestType;
  status: ModerationActionRequestStatus;
  actor_id: string;
  actor_surface: string;
  target_user_id: string | null;
  detection_event_id: string | null;
  report_intake_id: string | null;
  verification_event_id: string | null;
  message_deletion_job_id: string | null;
  idempotency_key: string;
  requested_at: Date | null;
  updated_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  attempts: number;
  last_error: string | null;
  metadata: Prisma.JsonValue | null;
  result: Prisma.JsonValue | null;
}

export interface ModerationActionRequestCreate {
  serverId: string;
  actionType: ModerationActionRequestType;
  actorId: string;
  actorSurface: string;
  targetUserId?: string | null;
  detectionEventId?: string | null;
  reportIntakeId?: string | null;
  verificationEventId?: string | null;
  messageDeletionJobId?: string | null;
  idempotencyKey: string;
  metadata?: Prisma.JsonValue | null;
}

export interface MessageDeletionJob {
  id: string;
  server_id: string;
  user_id: string;
  verification_event_id: string;
  requested_by: string;
  actor_surface: string;
  mode: MessageDeletionJobMode;
  ban_status: MessageDeletionBanStatus;
  case_finalization_status: MessageDeletionCaseFinalizationStatus;
  scope: MessageDeletionScope;
  status: MessageDeletionJobStatus;
  coverage: MessageDeletionCoverage | null;
  reason: string;
  evidence_thread_id: string;
  requested_window_start: Date | null;
  requested_window_end: Date | null;
  previewed_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  failed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  candidate_count: number;
  preserved_count: number;
  deleted_count: number;
  already_missing_count: number;
  changed_count: number;
  evidence_failed_count: number;
  delete_failed_count: number;
  permission_denied_count: number;
  last_error: string | null;
  metadata: Prisma.JsonValue | null;
}

export interface MessageDeletionItem {
  id: string;
  job_id: string;
  message_id: string;
  channel_id: string;
  author_id: string;
  message_created_at: Date;
  message_edited_at: Date | null;
  content_preview: string;
  attachment_count: number;
  discovery_source: MessageDeletionDiscoverySource;
  bulk_delete_eligible: boolean;
  evidence_status: MessageDeletionEvidenceStatus;
  status: MessageDeletionItemStatus;
  evidence_message_id: string | null;
  attempted_at: Date | null;
  evidence_preserved_at: Date | null;
  deleted_at: Date | null;
  completed_at: Date | null;
  failure_reason: string | null;
  metadata: Prisma.JsonValue | null;
}

export interface MessageDeletionJobWithItems extends MessageDeletionJob {
  items: MessageDeletionItem[];
}

export interface MessageDeletionJobCreate {
  serverId: string;
  userId: string;
  verificationEventId: string;
  requestedBy: string;
  actorSurface: string;
  mode: MessageDeletionJobMode;
  scope: MessageDeletionScope;
  reason: string;
  evidenceThreadId: string;
  metadata?: Prisma.JsonValue | null;
}

export interface MessageDeletionItemCreate {
  messageId: string;
  channelId: string;
  authorId: string;
  messageCreatedAt: Date;
  messageEditedAt?: Date | null;
  contentPreview: string;
  attachmentCount: number;
  discoverySource: MessageDeletionDiscoverySource;
  bulkDeleteEligible: boolean;
  metadata?: Prisma.JsonValue | null;
}

export interface MessageDeletionPreviewResult {
  coverage: MessageDeletionCoverage;
  requestedWindowStart?: Date | null;
  requestedWindowEnd?: Date | null;
  items: readonly MessageDeletionItemCreate[];
  metadata?: Prisma.JsonValue | null;
}

export interface MessageDeletionItemOutcome {
  status: MessageDeletionItemStatus;
  evidenceStatus: MessageDeletionEvidenceStatus;
  evidenceMessageId?: string | null;
  attemptedAt?: Date;
  evidencePreservedAt?: Date | null;
  deletedAt?: Date | null;
  completedAt?: Date;
  failureReason?: string | null;
  metadata?: Prisma.JsonValue | null;
}

export interface MessageDeletionJobSummary {
  preservedCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  changedCount: number;
  evidenceFailedCount: number;
  deleteFailedCount: number;
  permissionDeniedCount: number;
  metadata?: Prisma.JsonValue | null;
}

export interface VerificationEventWithActions extends VerificationEvent {
  actions: AdminAction[];
}

export interface MessageContext {
  id: string;
  server_id: string;
  user_id: string;
  message_id: string;
  channel_id: string | null;
  content_preview: string;
  content_features: Record<string, unknown>;
  created_at: Date;
  observed_at: Date;
  expires_at: Date;
}

export interface MessageContextCreate {
  serverId: string;
  userId: string;
  messageId: string;
  channelId?: string | null;
  contentPreview: string;
  contentFeatures?: Record<string, unknown>;
  createdAt: Date;
  observedAt?: Date;
  expiresAt: Date;
}

export enum ReportIntakeStatus {
  COLLECTING_EVIDENCE = 'collecting_evidence',
  NEEDS_REPORTER_CONFIRMATION = 'needs_reporter_confirmation',
  NEEDS_ADMIN_CONFIRMATION = 'needs_admin_confirmation',
  SUBMITTED = 'submitted',
  CLOSED_BY_REPORTER = 'closed_by_reporter',
  ACTIONED = 'actioned',
  DISMISSED = 'dismissed',
  FALSE_POSITIVE = 'false_positive',
  EXPIRED = 'expired',
}

export enum ReportIntakeEvidenceKind {
  REPORTER_TEXT = 'reporter_text',
  SCREENSHOT = 'screenshot',
  MESSAGE_LINK = 'message_link',
  REPORTED_TEXT = 'reported_text',
  FOLLOWUP_ANSWER = 'followup_answer',
  CANDIDATE_CONFIRMATION = 'candidate_confirmation',
  ADMIN_NOTE = 'admin_note',
}

export interface ReportIntake {
  id: string;
  server_id: string;
  reporter_id: string;
  thread_id: string | null;
  status: ReportIntakeStatus;
  summary: string | null;
  confirmed_target_user_id: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  closed_at: Date | null;
  metadata: Prisma.JsonValue | null;
}

export interface ReportIntakeEvidence {
  id: string;
  intake_id: string;
  kind: ReportIntakeEvidenceKind;
  source_message_id: string | null;
  source_channel_id: string | null;
  attachment_id: string | null;
  content: string | null;
  metadata: Prisma.JsonValue | null;
  created_at: Date | null;
}

export interface ReportIntakeCreate {
  serverId: string;
  reporterId: string;
  threadId?: string | null;
  status?: ReportIntakeStatus;
  summary?: string | null;
  confirmedTargetUserId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ReportIntakeUpdate {
  status?: ReportIntakeStatus;
  summary?: string | null;
  confirmedTargetUserId?: string | null;
  closedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

export interface ReportIntakeEvidenceCreate {
  intakeId: string;
  kind: ReportIntakeEvidenceKind;
  sourceMessageId?: string | null;
  sourceChannelId?: string | null;
  attachmentId?: string | null;
  content?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AdminActionCreate extends Omit<
  AdminAction,
  'id' | 'action_at' | 'metadata' | 'detection_event_id'
> {
  // Omit fields handled automatically or differently on create
  detection_event_id?: string | null; // Add optional field
  metadata?: Prisma.JsonValue | null; // Allow metadata on create
}

export interface ModerationOutcomeCreate extends Omit<
  ModerationOutcome,
  'id' | 'created_at' | 'metadata' | 'occurred_at'
> {
  occurred_at?: Date | null;
  metadata?: Prisma.JsonValue | null;
}
