import type { HumanCommand } from './commands';
import { caseNeedsConfirmation } from '../cases/actions';
import { detectionNeedsConfirmation } from '../detections/actions';
import { operationNeedsConfirmation } from '../operations/actions';
import { reportNeedsConfirmation } from '../reports/submission';
import { setupNeedsConfirmation } from '../setup/actions';
import { messageCleanupNeedsConfirmation } from '../messageCleanup/actions';

export type ConfirmationRequirement = 'none' | 'confirm' | 'preview_confirm';
const requirement = (needed: boolean): ConfirmationRequirement => (needed ? 'confirm' : 'none');
type CommandByKind = { [K in HumanCommand['kind']]: Extract<HumanCommand, { kind: K }> };
type ConfirmationPolicies = {
  [K in keyof CommandByKind]: (command: CommandByKind[K]) => ConfirmationRequirement;
};
const confirm = (): ConfirmationRequirement => 'confirm';
const none = (): ConfirmationRequirement => 'none';
const previewConfirm = (): ConfirmationRequirement => 'preview_confirm';
const casePolicy = (
  command: Parameters<typeof caseNeedsConfirmation>[0]
): ConfirmationRequirement => requirement(caseNeedsConfirmation(command));
const detectionPolicy = (
  command: Parameters<typeof detectionNeedsConfirmation>[0]
): ConfirmationRequirement => requirement(detectionNeedsConfirmation(command));
const operationPolicy = (
  command: Parameters<typeof operationNeedsConfirmation>[0]
): ConfirmationRequirement => requirement(operationNeedsConfirmation(command));
const reportPolicy = (
  command: Parameters<typeof reportNeedsConfirmation>[0]
): ConfirmationRequirement => requirement(reportNeedsConfirmation(command));
const setupPolicy = (
  command: Parameters<typeof setupNeedsConfirmation>[0]
): ConfirmationRequirement => requirement(setupNeedsConfirmation(command));
const cleanupPolicy = (
  command: Parameters<typeof messageCleanupNeedsConfirmation>[0]
): ConfirmationRequirement =>
  messageCleanupNeedsConfirmation(command) ? 'preview_confirm' : 'none';

/** Exhaustive dispatch keeps each native confirmation predicate authoritative. */
const policies: ConfirmationPolicies = {
  repair_active_case: (command) => requirement(command.intent === 'moderator_repair'),
  ban_user: casePolicy,
  kick_user: casePolicy,
  open_case_from_observed_detection: casePolicy,
  manual_flag_user: casePolicy,
  verify_case_user: casePolicy,
  close_case_no_action: casePolicy,
  kick_case_user: casePolicy,
  ban_case_user: casePolicy,
  ban_case_user_by_id: casePolicy,
  reopen_case: casePolicy,
  refresh_case_notification: casePolicy,
  sync_existing_ban: casePolicy,
  open_admin_case: casePolicy,
  review_uncertain_report_ban: previewConfirm,
  dismiss_observed_detection: detectionPolicy,
  mark_observed_detection_false_positive: detectionPolicy,
  undo_observed_detection_action: detectionPolicy,
  kick_observed_detection: detectionPolicy,
  ignore_detection_accounting: detectionPolicy,
  restore_detection_accounting: detectionPolicy,
  prepare_report_ban_review: detectionPolicy,
  ban_observed_detection: detectionPolicy,
  sync_moderation_queue: operationPolicy,
  clear_moderation_queue: operationPolicy,
  audit_case_role_lockdown: operationPolicy,
  apply_case_role_lockdown: operationPolicy,
  intake_role_members: operationPolicy,
  audit_integrity: operationPolicy,
  close_resolved_case_threads: operationPolicy,
  submit_user_report: reportPolicy,
  start_report_intake: reportPolicy,
  close_report_intake: reportPolicy,
  submit_message_report: reportPolicy,
  confirm_intake_candidate: reportPolicy,
  reject_intake_candidates: reportPolicy,
  update_settings: confirm,
  update_setup: confirm,
  update_heuristics: confirm,
  reset_heuristics: confirm,
  lockdown_allow_add: confirm,
  lockdown_allow_remove: confirm,
  disable_lockdown: confirm,
  complete_setup_verification: confirm,
  upsert_report_instructions: setupPolicy,
  clear_report_instructions: setupPolicy,
  preview_case_message_deletion: cleanupPolicy,
  execute_case_message_deletion: cleanupPolicy,
  ban_case_user_with_message_cleanup: cleanupPolicy,
  quarantine_compromised_account: previewConfirm,
  request_captcha_challenge: confirm,
  retry_captcha_challenge: confirm,
  bypass_captcha_challenge: confirm,
  open_submitted_report_case: confirm,
  preview_account_quarantine: none,
  close_submitted_report: none,
  acknowledge_attention: none,
};
function requirementForKind<K extends keyof CommandByKind>(
  kind: K,
  command: CommandByKind[K]
): ConfirmationRequirement {
  return policies[kind](command);
}
/** Delegated additions do not add a second modal to existing native/site control flows. */
export function confirmationRequirement(command: HumanCommand): ConfirmationRequirement {
  return requirementForKind(command.kind, command);
}
