UPDATE "servers"
SET "settings" = jsonb_set("settings", '{detection_response_mode}', '"notify_only"', false)
WHERE "settings" ->> 'detection_response_mode' = 'open_case';

UPDATE "servers"
SET "settings" = jsonb_set("settings", '{message_detection_response_mode}', '"notify_only"', false)
WHERE "settings" ->> 'message_detection_response_mode' = 'open_case';

UPDATE "servers"
SET "settings" = jsonb_set("settings", '{join_detection_response_mode}', '"notify_only"', false)
WHERE "settings" ->> 'join_detection_response_mode' = 'open_case';

UPDATE "servers"
SET "settings" = jsonb_set(
  "settings" - 'auto_restrict',
  '{detection_response_mode}',
  '"restrict"',
  true
)
WHERE "settings" ->> 'auto_restrict' = 'true'
  AND NOT ("settings" ? 'detection_response_mode');

UPDATE "servers"
SET "settings" = jsonb_set(
  "settings" - 'auto_restrict',
  '{detection_response_mode}',
  '"notify_only"',
  true
)
WHERE "settings" ->> 'auto_restrict' = 'false'
  AND NOT ("settings" ? 'detection_response_mode');

UPDATE "servers"
SET "settings" = "settings" - 'auto_restrict'
WHERE "settings" ? 'auto_restrict';

UPDATE "servers"
SET "settings" = jsonb_set(
  "settings" - 'observed_action_ban_requires_reason',
  '{moderator_ban_action_requires_reason}',
  "settings" -> 'observed_action_ban_requires_reason',
  true
)
WHERE "settings" ? 'observed_action_ban_requires_reason'
  AND NOT ("settings" ? 'moderator_ban_action_requires_reason')
  AND jsonb_typeof("settings" -> 'observed_action_ban_requires_reason') = 'boolean';

UPDATE "servers"
SET "settings" = "settings" - 'observed_action_ban_requires_reason'
WHERE "settings" ? 'observed_action_ban_requires_reason';
