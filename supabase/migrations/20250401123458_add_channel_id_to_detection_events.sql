-- Add channel_id column to detection_events table
ALTER TABLE detection_events ADD COLUMN channel_id TEXT;

-- Add comment for the new column
COMMENT ON COLUMN detection_events.channel_id IS 'Discord channel ID where the message was sent';

-- Create index for channel lookups
CREATE INDEX IF NOT EXISTS idx_detection_events_channel ON detection_events(channel_id); 