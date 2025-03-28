-- Migration to extend existing tables with flag functionality

-- Add flag-related columns to server_members table
ALTER TABLE server_members
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS restriction_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_status_change TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS moderator_id TEXT;

-- Add comments for the new server_members columns
COMMENT ON COLUMN server_members.verification_status IS 'Current verification status (pending, verified, rejected)';
COMMENT ON COLUMN server_members.restriction_reason IS 'Reason why the user was restricted';
COMMENT ON COLUMN server_members.last_status_change IS 'When the status was last changed';
COMMENT ON COLUMN server_members.moderator_id IS 'Discord ID of the moderator who changed the status';

-- Add reputation-related columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS suspicious_server_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS first_flagged_at TIMESTAMP WITH TIME ZONE;

-- Add comments for the new users columns
COMMENT ON COLUMN users.suspicious_server_count IS 'Number of servers where the user has been flagged as suspicious';
COMMENT ON COLUMN users.first_flagged_at IS 'When the user was first flagged in any server';

-- Create verification_threads table for thread tracking
CREATE TABLE IF NOT EXISTS verification_threads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT DEFAULT 'open',
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by TEXT,
  resolution TEXT,
  UNIQUE(server_id, thread_id)
);

-- Create indexes for verification_threads
CREATE INDEX IF NOT EXISTS idx_verification_threads_server ON verification_threads(server_id);
CREATE INDEX IF NOT EXISTS idx_verification_threads_user ON verification_threads(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_threads_status ON verification_threads(status);

-- Add comments for verification_threads
COMMENT ON TABLE verification_threads IS 'Discord verification threads for suspicious users';
COMMENT ON COLUMN verification_threads.thread_id IS 'Discord thread ID';
COMMENT ON COLUMN verification_threads.status IS 'Current thread status (open, resolved, abandoned)';
COMMENT ON COLUMN verification_threads.resolved_at IS 'When the thread was resolved';
COMMENT ON COLUMN verification_threads.resolved_by IS 'Discord ID of the user who resolved the thread';
COMMENT ON COLUMN verification_threads.resolution IS 'Resolution outcome (verified, banned, etc.)';

-- Enable Row Level Security (RLS)
ALTER TABLE verification_threads ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role to access all data
CREATE POLICY "Full access for service role" ON verification_threads
  USING (true)
  WITH CHECK (true); 