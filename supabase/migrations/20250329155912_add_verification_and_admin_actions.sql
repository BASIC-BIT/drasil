-- Migration: Add verification_events and admin_actions tables

-- Create verification_events table
CREATE TABLE IF NOT EXISTS verification_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  thread_id TEXT,
  message_id TEXT,
  status TEXT NOT NULL, -- 'pending', 'verified', 'rejected', 'reopened'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Create admin_actions table
CREATE TABLE IF NOT EXISTS admin_actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  admin_id TEXT NOT NULL, -- Discord ID of admin who took action
  verification_event_id UUID REFERENCES verification_events(id) ON DELETE CASCADE,
  detection_event_id UUID REFERENCES detection_events(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL, -- 'verify', 'reject', 'ban', 'reopen', 'create_thread', etc.
  action_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  previous_status TEXT, -- Status before this action
  new_status TEXT, -- Status after this action
  notes TEXT,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Add reference columns to existing tables
ALTER TABLE detection_events 
ADD COLUMN IF NOT EXISTS latest_verification_event_id UUID REFERENCES verification_events(id) ON DELETE SET NULL;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_verification_events_server ON verification_events(server_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_user ON verification_events(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_detection ON verification_events(detection_event_id);
CREATE INDEX IF NOT EXISTS idx_verification_events_status ON verification_events(status);

CREATE INDEX IF NOT EXISTS idx_admin_actions_server ON admin_actions(server_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_user ON admin_actions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_admin ON admin_actions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_verification ON admin_actions(verification_event_id);
CREATE INDEX IF NOT EXISTS idx_admin_actions_detection ON admin_actions(detection_event_id);

-- Add table comments
COMMENT ON TABLE verification_events IS 'Tracks verification events for suspicious users';
COMMENT ON TABLE admin_actions IS 'Records all admin actions for audit and accountability';

-- Add column comments
COMMENT ON COLUMN verification_events.status IS 'Current status of the verification event: pending, verified, rejected, reopened';
COMMENT ON COLUMN verification_events.thread_id IS 'Discord thread ID if a verification thread was created';
COMMENT ON COLUMN verification_events.message_id IS 'Discord message ID of the verification notification';
COMMENT ON COLUMN verification_events.resolved_at IS 'When the verification was resolved (verified or rejected)';
COMMENT ON COLUMN verification_events.notes IS 'Optional notes about the verification';

COMMENT ON COLUMN admin_actions.admin_id IS 'Discord ID of the administrator who took the action';
COMMENT ON COLUMN admin_actions.action_type IS 'Type of action taken: verify, reject, ban, reopen, create_thread';
COMMENT ON COLUMN admin_actions.previous_status IS 'Status before the action was taken';
COMMENT ON COLUMN admin_actions.new_status IS 'Status after the action was taken';
COMMENT ON COLUMN admin_actions.notes IS 'Optional notes about the action';
