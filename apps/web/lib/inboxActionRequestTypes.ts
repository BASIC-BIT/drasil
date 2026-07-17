import type { ModerationActionRequestActionType } from './moderationActionRequestQueue';

export const inboxModerationActionRequestTypes = [
  'open_case_from_observed_detection',
  'dismiss_observed_detection',
  'mark_observed_detection_false_positive',
  'kick_observed_detection',
  'ban_observed_detection',
  'verify_case_user',
  'close_case_no_action',
  'kick_case_user',
  'ban_case_user',
  'preview_case_message_deletion',
  'execute_case_message_deletion',
  'ban_case_user_with_message_cleanup',
  'ban_case_user_by_id',
  'repair_active_case',
  'reopen_case',
  'refresh_case_notification',
  'sync_existing_ban',
] as const satisfies readonly ModerationActionRequestActionType[];
