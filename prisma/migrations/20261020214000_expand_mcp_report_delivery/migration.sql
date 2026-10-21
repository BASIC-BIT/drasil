ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'submit_message_report';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'confirm_intake_candidate';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'reject_intake_candidates';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'prepare_report_ban_review';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'review_uncertain_report_ban';
