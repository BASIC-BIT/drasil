-- Migration to add verification message ID field

-- Add verification_message_id column to server_members table
ALTER TABLE server_members
  ADD COLUMN IF NOT EXISTS verification_message_id TEXT;

-- Add comment for the new column
COMMENT ON COLUMN server_members.verification_message_id IS 'Discord message ID of the verification/warning message in admin channel';

-- Create index for faster lookups by message ID
CREATE INDEX IF NOT EXISTS idx_server_members_verification_message ON server_members(verification_message_id); 