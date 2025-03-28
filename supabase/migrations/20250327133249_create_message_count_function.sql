-- Function to atomically increment a member's message count and update last message timestamp
CREATE OR REPLACE FUNCTION increment_member_message_count(
  p_server_id TEXT,
  p_user_id TEXT,
  p_timestamp TIMESTAMP WITH TIME ZONE
)
RETURNS server_members
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_member server_members;
BEGIN
  UPDATE server_members
  SET 
    message_count = COALESCE(message_count, 0) + 1,
    last_message_at = p_timestamp
  WHERE 
    server_id = p_server_id 
    AND user_id = p_user_id
  RETURNING * INTO updated_member;

  -- If no row was updated, the member doesn't exist yet
  IF NOT FOUND THEN
    INSERT INTO server_members (
      server_id,
      user_id,
      message_count,
      last_message_at,
      join_date
    )
    VALUES (
      p_server_id,
      p_user_id,
      1,
      p_timestamp,
      p_timestamp
    )
    RETURNING * INTO updated_member;
  END IF;

  RETURN updated_member;
END;
$$;

-- Add comment to the function
COMMENT ON FUNCTION increment_member_message_count IS 'Atomically increments message count and updates last message timestamp for a server member';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_member_message_count TO authenticated; 