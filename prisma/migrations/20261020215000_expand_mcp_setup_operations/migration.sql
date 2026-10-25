ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'audit_integrity';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'update_settings';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'update_heuristics';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'reset_heuristics';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'lockdown_allow_add';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'lockdown_allow_remove';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'disable_lockdown';
ALTER TYPE moderation_action_request_type ADD VALUE IF NOT EXISTS 'clear_report_instructions';
