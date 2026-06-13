ALTER TYPE admin_action_type ADD VALUE IF NOT EXISTS 'close_no_action';
ALTER TYPE moderation_outcome_type ADD VALUE IF NOT EXISTS 'closed_no_action';
ALTER TYPE report_intake_status ADD VALUE IF NOT EXISTS 'dismissed';
ALTER TYPE report_intake_status ADD VALUE IF NOT EXISTS 'false_positive';
ALTER TYPE verification_status ADD VALUE IF NOT EXISTS 'closed_no_action';
