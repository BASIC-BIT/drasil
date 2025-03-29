/**
 * TypeScript types for database entities
 */

/**
 * Server/Guild configuration entity
 */
export interface Server {
  guild_id: string; // Discord guild/server ID (primary key)
  restricted_role_id?: string; // ID of role used for restricted users
  admin_channel_id?: string; // ID of admin notification channel
  verification_channel_id?: string; // ID of verification channel
  admin_notification_role_id?: string; // ID of role to ping for notifications
  created_at?: string; // Creation timestamp
  updated_at?: string; // Last update timestamp
  settings?: ServerSettings; // JSON blob for flexible settings
  is_active: boolean; // Whether the bot is active in this server
}

/**
 * Flexible server settings stored as JSON
 */
export interface ServerSettings {
  message_threshold?: number; // Number of messages before triggering detection
  message_timeframe?: number; // Timeframe in seconds for message threshold
  suspicious_keywords?: string[]; // Keywords that trigger detection
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
  username?: string; // Discord username
  created_at?: string; // Creation timestamp
  updated_at?: string; // Last update timestamp
  global_reputation_score?: number; // Cross-server reputation score
  account_created_at?: string; // When the Discord account was created
  metadata?: Record<string, unknown>; // Additional metadata
  suspicious_server_count?: number; // Number of servers where the user has been flagged
  first_flagged_at?: string; // When the user was first flagged in any server
}

/**
 * Server member (user in a specific server)
 */
export interface ServerMember {
  server_id: string; // Discord server ID (primary key with user_id)
  user_id: string; // Discord user ID (primary key with server_id)
  join_date?: string; // When the user joined the server
  reputation_score?: number; // Server-specific reputation score
  is_restricted?: boolean; // Whether user is currently restricted
  last_verified_at?: string; // Last time user was verified
  last_message_at?: string; // Last time user sent a message
  message_count?: number; // Total message count in server
  verification_status?: 'pending' | 'verified' | 'rejected'; // Current verification status
  restriction_reason?: string; // Reason why the user was restricted
  last_status_change?: string; // When the status was last changed
  moderator_id?: string; // Discord ID of the moderator who changed the status
  verification_message_id?: string; // Discord message ID of the verification/warning message
}

/**
 * Represents a spam detection event
 */
export interface DetectionEvent {
  id: string; // UUID for the event
  server_id: string; // Discord server ID
  user_id: string; // Discord user ID
  message_id?: string; // Discord message ID
  channel_id?: string; // Discord channel ID where the message was sent
  detection_type: string;
  confidence: number;
  confidence_level: 'Low' | 'Medium' | 'High';
  reasons: string[];
  used_gpt: boolean;
  detected_at: string | Date;
  admin_action?: 'Verified' | 'Banned' | 'Ignored';
  admin_action_by?: string;
  admin_action_at?: string | Date;
  metadata?: Record<string, unknown>;
}

/**
 * Represents a verification thread for a suspicious user
 */
export interface VerificationThread {
  id: string; // UUID for the thread record
  server_id: string; // Discord server ID
  user_id: string; // Discord user ID
  thread_id: string; // Discord thread ID
  created_at: string | Date; // When the thread was created
  status: 'open' | 'resolved' | 'abandoned'; // Current thread status
  resolved_at?: string | Date; // When the thread was resolved
  resolved_by?: string; // Discord ID of the user who resolved the thread
  resolution?: 'verified' | 'banned' | 'ignored'; // Resolution outcome
}
