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
  auto_restrict?: boolean; // Whether to automatically restrict users
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
  observed_action_ban_requires_reason?: boolean;
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
  moderation_queue_channel_id?: string | null;
  setup_nudge_last_attempt_at?: string | null;
  setup_nudge_last_recipient_id?: string | null;
  setup_nudge_last_result?: 'sent' | 'dm_failed' | 'no_recipient' | null;
  setup_nudge_last_source?: 'audit_log_installer' | 'owner' | null;
  setup_warning_last_fingerprint?: string | null;
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
