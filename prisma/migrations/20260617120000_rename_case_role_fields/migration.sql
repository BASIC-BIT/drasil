ALTER TABLE "servers" RENAME COLUMN "restricted_role_id" TO "case_role_id";

ALTER TABLE "server_members" RENAME COLUMN "is_restricted" TO "case_role_active";

ALTER INDEX IF EXISTS "idx_server_members_user_server_status" RENAME TO "idx_server_members_user_server_case_role";

UPDATE "servers"
SET "settings" =
  ("settings" - 'restricted_lockdown_enabled' - 'restricted_lockdown_allowed_channel_ids' - 'restricted_lockdown_allowed_category_ids') ||
  jsonb_strip_nulls(
    jsonb_build_object(
      'case_role_lockdown_enabled', "settings" -> 'restricted_lockdown_enabled',
      'case_role_lockdown_allowed_channel_ids', "settings" -> 'restricted_lockdown_allowed_channel_ids',
      'case_role_lockdown_allowed_category_ids', "settings" -> 'restricted_lockdown_allowed_category_ids'
    )
  )
WHERE "settings" ?| ARRAY[
  'restricted_lockdown_enabled',
  'restricted_lockdown_allowed_channel_ids',
  'restricted_lockdown_allowed_category_ids'
];
