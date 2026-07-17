ALTER TYPE "moderation_action_request_type" ADD VALUE IF NOT EXISTS 'preview_case_message_deletion';
ALTER TYPE "moderation_action_request_type" ADD VALUE IF NOT EXISTS 'execute_case_message_deletion';
ALTER TYPE "moderation_action_request_type" ADD VALUE IF NOT EXISTS 'ban_case_user_with_message_cleanup';
