-- Create detection events table
CREATE TABLE IF NOT EXISTS detection_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  server_id TEXT REFERENCES servers(guild_id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(discord_id) ON DELETE CASCADE,
  message_id TEXT,
  detection_type TEXT NOT NULL,
  confidence REAL,
  confidence_level TEXT, -- 'Low', 'Medium', 'High'
  reasons TEXT[],
  used_gpt BOOLEAN DEFAULT FALSE,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  admin_action TEXT, -- 'Verified', 'Banned', 'Ignored'
  admin_action_by TEXT, -- Discord ID of admin who took action
  admin_action_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'::JSONB
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_detection_events_server ON detection_events(server_id);
CREATE INDEX IF NOT EXISTS idx_detection_events_user ON detection_events(user_id);
CREATE INDEX IF NOT EXISTS idx_detection_events_date ON detection_events(detected_at);

-- Add table and column comments
COMMENT ON TABLE detection_events IS 'Records of spam detection incidents';
COMMENT ON COLUMN detection_events.detection_type IS 'Type of detection (e.g., SUSPICIOUS, OK)';
COMMENT ON COLUMN detection_events.confidence_level IS 'Human-readable confidence level (Low, Medium, High)';
COMMENT ON COLUMN detection_events.reasons IS 'Array of reasons why the detection was triggered';
COMMENT ON COLUMN detection_events.used_gpt IS 'Whether GPT was used in the detection';
COMMENT ON COLUMN detection_events.admin_action IS 'Action taken by admin (Verified, Banned, Ignored)';
COMMENT ON COLUMN detection_events.admin_action_by IS 'Discord ID of the admin who took action';
COMMENT ON COLUMN detection_events.metadata IS 'Additional JSON data about the detection event';

-- Enable Row Level Security (RLS)
ALTER TABLE detection_events ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role to access all data
CREATE POLICY "Full access for service role" ON detection_events
  USING (true)
  WITH CHECK (true); 