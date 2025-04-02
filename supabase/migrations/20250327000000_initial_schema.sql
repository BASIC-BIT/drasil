-- Initial schema for Discord anti-spam bot

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom enum types
CREATE TYPE verification_status AS ENUM (
  'pending',
  'verified',
  'rejected'
);

CREATE TYPE admin_action_type AS ENUM (
  'verify',
  'reject',
  'ban',
  'reopen',
  'create_thread'
);

CREATE TYPE detection_type AS ENUM (
  'message_frequency',
  'suspicious_content',
  'gpt_analysis',
  'new_account',
  'pattern_match'
);

-- Servers table (guild configuration)
CREATE TABLE IF NOT EXISTS servers (
  guild_id TEXT PRIMARY KEY, -- Using Discord guild ID directly as primary key
  restricted_role_id TEXT,
  admin_channel_id TEXT,
  verification_channel_id TEXT,
  admin_notification_role_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Discord ID of who created the record
  updated_by TEXT, -- Discord ID of who last updated the record
  settings JSONB DEFAULT '{}'::JSONB,
  is_active BOOLEAN DEFAULT TRUE
);

COMMENT ON TABLE servers IS 'Discord servers where the bot is installed';
COMMENT ON COLUMN servers.settings IS 'JSON blob for flexible configuration storage (heuristic thresholds, GPT settings, etc.)';
COMMENT ON COLUMN servers.created_by IS 'Discord ID of who created the record';
COMMENT ON COLUMN servers.updated_by IS 'Discord ID of who last updated the record';

-- Users table
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY, -- Using Discord user ID directly as primary key
  username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by TEXT, -- Discord ID of who created the record
  updated_by TEXT, -- Discord ID of who last updated the record
  global_reputation_score REAL,
  account_created_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::JSONB
);

COMMENT ON TABLE users IS 'Discord users across all servers';
COMMENT ON COLUMN users.global_reputation_score IS 'Cross-server reputation score (higher is more trusted)';
COMMENT ON COLUMN users.created_by IS 'Discord ID of who created the record';
COMMENT ON COLUMN users.updated_by IS 'Discord ID of who last updated the record';

-- Server members (users in specific servers)
CREATE TABLE IF NOT EXISTS server_members (
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  join_date TIMESTAMP WITH TIME ZONE,
  reputation_score REAL DEFAULT 0.0,
  is_restricted BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  last_message_at TIMESTAMP WITH TIME ZONE,
  message_count INTEGER DEFAULT 0,
  verification_status verification_status DEFAULT 'pending',
  last_status_change TIMESTAMP WITH TIME ZONE,
  created_by TEXT, -- Discord ID of who created the record
  updated_by TEXT, -- Discord ID of who last updated the record
  PRIMARY KEY (server_id, user_id)
-- Commenting out this constraint for now - it's not important at the moment
--  CONSTRAINT chk_reputation_range CHECK (reputation_score >= -1.0 AND reputation_score <= 1.0)
);

CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user_server_status ON server_members(user_id, server_id, is_restricted);

COMMENT ON TABLE server_members IS 'Mapping table for users in specific Discord servers';
COMMENT ON COLUMN server_members.reputation_score IS 'Server-specific reputation score';
COMMENT ON COLUMN server_members.created_by IS 'Discord ID of who created the record';
COMMENT ON COLUMN server_members.updated_by IS 'Discord ID of who last updated the record';

-- Detection events table
CREATE TABLE IF NOT EXISTS detection_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  detection_type detection_type NOT NULL,
  confidence REAL NOT NULL, -- 0.0 to 1.0
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_id TEXT,
  channel_id TEXT,
  thread_id TEXT,
  reasons TEXT[],
  metadata JSONB DEFAULT '{}'::JSONB,
  admin_action TEXT, -- 'verified', 'banned', etc.
  admin_action_by TEXT, -- Discord ID of admin who took action
  admin_action_at TIMESTAMP WITH TIME ZONE,
  latest_verification_event_id UUID -- Will be linked after verification_events table is created
-- Commenting out this constraint for now - it's not important at the moment
--  CONSTRAINT chk_confidence_range CHECK (confidence >= 0.0 AND confidence <= 1.0)
);

CREATE INDEX IF NOT EXISTS idx_detection_events_server ON detection_events(server_id);
CREATE INDEX IF NOT EXISTS idx_detection_events_user ON detection_events(user_id);
CREATE INDEX IF NOT EXISTS idx_detection_events_type ON detection_events(detection_type);
CREATE INDEX IF NOT EXISTS idx_detection_events_detected_at ON detection_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_detection_events_user_server_type ON detection_events(user_id, server_id, detection_type);
CREATE INDEX IF NOT EXISTS idx_detection_events_detected_at_range ON detection_events USING BRIN(detected_at);

COMMENT ON TABLE detection_events IS 'Records of suspicious activity detections';
COMMENT ON COLUMN detection_events.confidence IS 'Confidence score of the detection (0.0 to 1.0)';
COMMENT ON COLUMN detection_events.reasons IS 'Array of reasons for the detection';
COMMENT ON COLUMN detection_events.metadata IS 'Additional detection-specific data';

-- Message count function
CREATE OR REPLACE FUNCTION get_recent_message_count(
  p_user_id TEXT,
  p_server_id TEXT,
  p_timeframe_seconds INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  message_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO message_count
  FROM detection_events
  WHERE user_id = p_user_id
    AND server_id = p_server_id
    AND detection_type = 'message_frequency'
    AND detected_at >= NOW() - (p_timeframe_seconds || ' seconds')::INTERVAL;
    
  RETURN message_count;
END;
$$;

COMMENT ON FUNCTION get_recent_message_count IS 'Returns the number of messages sent by a user in a server within the specified timeframe';

-- Verification events table
CREATE TABLE IF NOT EXISTS verification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  thread_id TEXT,
  notification_message_id TEXT,
  status verification_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT, -- Discord ID of the admin who resolved this verification event
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Create admin_actions table
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL, -- Discord ID of admin who took action
  verification_event_id UUID REFERENCES verification_events(id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  action_type admin_action_type NOT NULL,
  action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  previous_status verification_status,
  new_status verification_status,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Now that verification_events exists, add the foreign key reference
ALTER TABLE detection_events 
ADD CONSTRAINT fk_detection_events_verification 
FOREIGN KEY (latest_verification_event_id) 
REFERENCES verification_events(id) 
ON DELETE SET NULL;

-- Add indexes for verification events
CREATE INDEX IF NOT EXISTS idx_verification_events_server ON verification_events(server_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_user ON verification_events(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_detection ON verification_events(detection_event_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_status ON verification_events(status);
CREATE INDEX IF NOT EXISTS idx_verification_events_user_server_status ON verification_events(user_id, server_id, status);
CREATE INDEX IF NOT EXISTS idx_verification_events_created_at_range ON verification_events USING BRIN(created_at);

-- Add indexes for admin actions
CREATE INDEX IF NOT EXISTS idx_admin_actions_server ON admin_actions(server_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_user ON admin_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_verification ON admin_actions(verification_event_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_detection ON admin_actions(detection_event_id);

-- Add verification events comments
COMMENT ON TABLE verification_events IS 'Tracks verification events for suspicious users';
COMMENT ON COLUMN verification_events.status IS 'Current status of the verification event: pending, verified, rejected, reopened';
COMMENT ON COLUMN verification_events.thread_id IS 'Discord thread ID if a verification thread was created';
COMMENT ON COLUMN verification_events.notification_message_id IS 'Discord message ID of the verification notification';
COMMENT ON COLUMN verification_events.resolved_at IS 'When the verification was resolved (verified or rejected)';
COMMENT ON COLUMN verification_events.notes IS 'Optional notes about the verification';

-- Add admin actions comments
COMMENT ON TABLE admin_actions IS 'Records all admin actions for audit and accountability';
COMMENT ON COLUMN admin_actions.admin_id IS 'Discord ID of the administrator who took the action';
COMMENT ON COLUMN admin_actions.action_type IS 'Type of action taken: verify, reject, ban, reopen, create_thread';
COMMENT ON COLUMN admin_actions.previous_status IS 'Status before the action was taken';
COMMENT ON COLUMN admin_actions.new_status IS 'Status after the action was taken';
COMMENT ON COLUMN admin_actions.notes IS 'Optional notes about the action';

-- Enable Row Level Security (RLS)
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE detection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_actions ENABLE ROW LEVEL SECURITY;

-- Create policies to allow service role to access all data
CREATE POLICY "Full access for service role" ON servers
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Full access for service role" ON users
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Full access for service role" ON server_members
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Full access for service role" ON detection_events
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Full access for service role" ON verification_events
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Full access for service role" ON admin_actions
  USING (true)
  WITH CHECK (true);