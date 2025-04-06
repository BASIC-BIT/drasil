import { Prisma } from '@prisma/client';
/**
 * TypeScript types for database entities
 */

/**
 * Server/Guild configuration entity
 */
export interface Server {
  guild_id: string; // Discord guild/server ID (primary key)
  restricted_role_id: string | null; // ID of role used for restricted users
  admin_channel_id: string | null; // ID of admin notification channel
  verification_channel_id: string | null; // ID of verification channel
  admin_notification_role_id: string | null; // ID of role to ping for notifications
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
  message_threshold?: number; // Number of messages before triggering detection
  message_timeframe?: number; // Timeframe in seconds for message threshold
  suspicious_keywords: string[] | null; // Keywords that trigger detection
  min_confidence_threshold?: number; // Minimum confidence for GPT detection
  auto_restrict?: boolean; // Whether to automatically restrict users
  use_gpt_on_join?: boolean; // Whether to use GPT for join verification
  gpt_message_check_count?: number; // Number of messages to check with GPT
  message_retention_days?: number; // Days to retain message history
  detection_retention_days?: number; // Days to retain detection history
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
  is_restricted?: boolean; // Whether user is currently restricted
  last_verified_at: string | null; // Last time user was verified
  last_message_at: string | null; // Last time user sent a message
  message_count?: number; // Total message count in server
  verification_status?: VerificationStatus; // Add missing status field (use enum from below)
  last_status_change: Date | null; // When the status was last changed (Use Date type)
  // Remove fields not present in the database schema
  // restriction_reason: string | null;
  // moderator_id: string | null;
  created_by: string | null; // Discord ID of who created the record
  updated_by: string | null; // Discord ID of who last updated the record
}

export enum DetectionType {
  MESSAGE_FREQUENCY = 'message_frequency',
  SUSPICIOUS_CONTENT = 'suspicious_content',
  GPT_ANALYSIS = 'gpt_analysis',
  NEW_ACCOUNT = 'new_account',
  PATTERN_MATCH = 'pattern_match',
  USER_REPORT = 'user_report',
}

/**
 * Represents a spam detection event
 */
export interface DetectionEvent {
  id: string; // UUID for the event
  server_id: string; // Discord server ID
  user_id: string; // Discord user ID
  thread_id: string | null; // Discord thread ID if applicable
  message_id: string | null; // Discord message ID
  channel_id: string | null; // Discord channel ID where the message was sent
  detection_type: DetectionType;
  confidence: number; // 0.0 to 1.0
  reasons: string[];
  detected_at: string | Date;
  metadata?: Record<string, unknown>;
}

export enum VerificationStatus {
  PENDING = 'pending',
  VERIFIED = 'verified',
  BANNED = 'banned',
}

export enum AdminActionType {
  VERIFY = 'verify',
  REJECT = 'reject',
  BAN = 'ban',
  REOPEN = 'reopen',
  CREATE_THREAD = 'create_thread',
}

export interface VerificationEvent {
  id: string;
  server_id: string;
  user_id: string;
  detection_event_id: string | null;
  thread_id: string | null;
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
  server_id: string;
  user_id: string;
  admin_id: string;
  verification_event_id: string;
  action_type: AdminActionType;
  action_at: Date; // Use Date type
  previous_status: VerificationStatus;
  new_status: VerificationStatus;
  notes: string | null;
  metadata: Prisma.JsonValue | null; // Align with Prisma JSON type
}

export interface VerificationEventWithActions extends VerificationEvent {
  actions: AdminAction[];
}

export interface AdminActionCreate extends Omit<AdminAction, 'id' | 'action_at' | 'metadata'> {
  // Omit fields handled automatically or differently on create
  detection_event_id?: string | null; // Add optional field
  metadata?: Prisma.JsonValue | null; // Allow metadata on create
}
