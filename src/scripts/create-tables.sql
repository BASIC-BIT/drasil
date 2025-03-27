-- This script creates the initial database schema for the Discord anti-spam bot
-- Run this in your Supabase SQL editor

-- Servers table (guild configuration)
CREATE TABLE IF NOT EXISTS servers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  guild_id TEXT UNIQUE NOT NULL,
  restricted_role_id TEXT,
  admin_channel_id TEXT,
  verification_channel_id TEXT,
  admin_notification_role_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  settings JSONB DEFAULT '{}'::JSONB,
  is_active BOOLEAN DEFAULT TRUE
);

COMMENT ON TABLE servers IS 'Discord servers where the bot is installed';
COMMENT ON COLUMN servers.settings IS 'JSON blob for flexible configuration storage (heuristic thresholds, GPT settings, etc.)';

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  discord_id TEXT NOT NULL,
  username TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  global_reputation_score REAL,
  account_created_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::JSONB,
  UNIQUE(discord_id)
);

COMMENT ON TABLE users IS 'Discord users across all servers';
COMMENT ON COLUMN users.global_reputation_score IS 'Cross-server reputation score (higher is more trusted)';

-- Server members (users in specific servers)
CREATE TABLE IF NOT EXISTS server_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  join_date TIMESTAMP WITH TIME ZONE,
  reputation_score REAL DEFAULT 0.0,
  is_restricted BOOLEAN DEFAULT FALSE,
  last_verified_at TIMESTAMP WITH TIME ZONE,
  last_message_at TIMESTAMP WITH TIME ZONE,
  message_count INTEGER DEFAULT 0,
  UNIQUE(server_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_server_members_server ON server_members(server_id);
CREATE INDEX IF NOT EXISTS idx_server_members_user ON server_members(user_id);

COMMENT ON TABLE server_members IS 'Mapping table for users in specific Discord servers';
COMMENT ON COLUMN server_members.reputation_score IS 'Server-specific reputation score';

-- Enable Row Level Security (RLS)
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_members ENABLE ROW LEVEL SECURITY;

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