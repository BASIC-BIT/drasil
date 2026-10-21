import { queuedSetupCommandSchema, type QueuedSetupCommand } from '../setup/commands';
import { queuedReportCommandSchema, type QueuedReportCommand } from '../reports/commands';
import { queuedOperationCommandSchema, type QueuedOperationCommand } from '../operations/commands';
import {
  messageCleanupCommandSchema,
  type MessageCleanupCommand,
} from '../messageCleanup/commands';
import { captchaCommandSchema, type CaptchaCommand } from '../containment/captcha';
import {
  queuedQuarantineCommandSchema,
  type QueuedQuarantineCommand,
} from '../containment/commands';
import { z } from 'zod';
import { queuedDetectionCommandSchema, type QueuedDetectionCommand } from '../detections/commands';
import { caseCommandSchema, type CaseCommand } from '../cases/commands';
type QueuedCaseCommand = CaseCommand;
const queuedCaseCommandSchema = caseCommandSchema;

export type QueuedCommand =
  | QueuedSetupCommand
  | QueuedReportCommand
  | QueuedOperationCommand
  | CaptchaCommand
  | MessageCleanupCommand
  | QueuedCaseCommand
  | QueuedDetectionCommand
  | QueuedQuarantineCommand;
export const queuedCommandSchema = z.union([
  queuedSetupCommandSchema,
  queuedReportCommandSchema,
  queuedOperationCommandSchema,
  messageCleanupCommandSchema,
  captchaCommandSchema,
  queuedCaseCommandSchema,
  queuedDetectionCommandSchema,
  queuedQuarantineCommandSchema,
]);

export function isQueuedCaptchaCommand(command: QueuedCommand): command is CaptchaCommand {
  switch (command.kind) {
    case 'request_captcha_challenge':
    case 'retry_captcha_challenge':
    case 'bypass_captcha_challenge':
    case 'apply_captcha_pass':
    case 'notify_captcha_attention':
      return true;
    default:
      return false;
  }
}

export function isQueuedMessageCleanupCommand(
  command: QueuedCommand
): command is MessageCleanupCommand {
  return (
    command.kind === 'preview_case_message_deletion' ||
    command.kind === 'execute_case_message_deletion' ||
    command.kind === 'ban_case_user_with_message_cleanup'
  );
}

function schemaFor<K extends QueuedCommand['kind']>(
  kind: K
): z.ZodType<Extract<QueuedCommand, { kind: K }>, z.ZodTypeDef, unknown> {
  return queuedCommandSchema.refine(
    (command): command is Extract<QueuedCommand, { kind: K }> => command.kind === kind,
    'Queued command kind mismatch.'
  );
}
/** Exhaustive persisted command registry; direct-only operations are deliberately absent. */
export const queuedCommandSchemas = {
  ban_user: schemaFor('ban_user'),
  kick_user: schemaFor('kick_user'),
  open_case_from_observed_detection: schemaFor('open_case_from_observed_detection'),
  open_admin_case: schemaFor('open_admin_case'),
  manual_flag_user: schemaFor('manual_flag_user'),
  verify_case_user: schemaFor('verify_case_user'),
  close_case_no_action: schemaFor('close_case_no_action'),
  kick_case_user: schemaFor('kick_case_user'),
  ban_case_user: schemaFor('ban_case_user'),
  ban_case_user_by_id: schemaFor('ban_case_user_by_id'),
  repair_active_case: schemaFor('repair_active_case'),
  reopen_case: schemaFor('reopen_case'),
  refresh_case_notification: schemaFor('refresh_case_notification'),
  sync_existing_ban: schemaFor('sync_existing_ban'),
  dismiss_observed_detection: schemaFor('dismiss_observed_detection'),
  mark_observed_detection_false_positive: schemaFor('mark_observed_detection_false_positive'),
  undo_observed_detection_action: schemaFor('undo_observed_detection_action'),
  kick_observed_detection: schemaFor('kick_observed_detection'),
  ban_observed_detection: schemaFor('ban_observed_detection'),
  ignore_detection_accounting: schemaFor('ignore_detection_accounting'),
  restore_detection_accounting: schemaFor('restore_detection_accounting'),
  preview_account_quarantine: schemaFor('preview_account_quarantine'),
  quarantine_compromised_account: schemaFor('quarantine_compromised_account'),
  request_captcha_challenge: schemaFor('request_captcha_challenge'),
  retry_captcha_challenge: schemaFor('retry_captcha_challenge'),
  bypass_captcha_challenge: schemaFor('bypass_captcha_challenge'),
  apply_captcha_pass: schemaFor('apply_captcha_pass'),
  notify_captcha_attention: schemaFor('notify_captcha_attention'),
  preview_case_message_deletion: schemaFor('preview_case_message_deletion'),
  execute_case_message_deletion: schemaFor('execute_case_message_deletion'),
  ban_case_user_with_message_cleanup: schemaFor('ban_case_user_with_message_cleanup'),
  sync_moderation_queue: schemaFor('sync_moderation_queue'),
  clear_moderation_queue: schemaFor('clear_moderation_queue'),
  close_resolved_case_threads: schemaFor('close_resolved_case_threads'),
  audit_case_role_lockdown: schemaFor('audit_case_role_lockdown'),
  apply_case_role_lockdown: schemaFor('apply_case_role_lockdown'),
  intake_role_members: schemaFor('intake_role_members'),
  submit_user_report: schemaFor('submit_user_report'),
  start_report_intake: schemaFor('start_report_intake'),
  close_report_intake: schemaFor('close_report_intake'),
  complete_setup_verification: schemaFor('complete_setup_verification'),
  upsert_report_instructions: schemaFor('upsert_report_instructions'),
} satisfies Record<QueuedCommand['kind'], z.ZodType<QueuedCommand, z.ZodTypeDef, unknown>>;
