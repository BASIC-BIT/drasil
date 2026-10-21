import type { HumanCommand } from './commands';
import { caseNeedsConfirmation } from '../cases/actions';
import { detectionNeedsConfirmation } from '../detections/actions';
import { operationNeedsConfirmation } from '../operations/actions';
import { reportNeedsConfirmation } from '../reports/submission';
import { setupNeedsConfirmation } from '../setup/actions';
import { messageCleanupNeedsConfirmation } from '../messageCleanup/actions';

export type ConfirmationRequirement = 'none' | 'confirm' | 'preview_confirm';
const requirement = (needed: boolean): ConfirmationRequirement => (needed ? 'confirm' : 'none');
/** Delegated additions do not add a second modal to existing native/site control flows. */
export function confirmationRequirement(command: HumanCommand): ConfirmationRequirement {
  switch (command.kind) {
    case 'repair_active_case':
      return requirement(command.intent === 'moderator_repair');
    case 'ban_user':
    case 'kick_user':
    case 'open_case_from_observed_detection':
    case 'manual_flag_user':
    case 'verify_case_user':
    case 'close_case_no_action':
    case 'kick_case_user':
    case 'ban_case_user':
    case 'ban_case_user_by_id':
    case 'reopen_case':
    case 'refresh_case_notification':
    case 'sync_existing_ban':
    case 'open_admin_case':
      return requirement(caseNeedsConfirmation(command));
    case 'review_uncertain_report_ban':
      return 'preview_confirm';
    case 'dismiss_observed_detection':
    case 'mark_observed_detection_false_positive':
    case 'undo_observed_detection_action':
    case 'kick_observed_detection':
    case 'ignore_detection_accounting':
    case 'restore_detection_accounting':
    case 'prepare_report_ban_review':
    case 'ban_observed_detection':
      return requirement(detectionNeedsConfirmation(command));
    case 'sync_moderation_queue':
    case 'clear_moderation_queue':
    case 'audit_case_role_lockdown':
    case 'apply_case_role_lockdown':
    case 'intake_role_members':
    case 'audit_integrity':
    case 'close_resolved_case_threads':
      return requirement(operationNeedsConfirmation(command));
    case 'submit_user_report':
    case 'start_report_intake':
    case 'close_report_intake':
    case 'submit_message_report':
    case 'confirm_intake_candidate':
    case 'reject_intake_candidates':
      return requirement(reportNeedsConfirmation(command));
    case 'update_settings':
    case 'update_setup':
    case 'update_heuristics':
    case 'reset_heuristics':
    case 'lockdown_allow_add':
    case 'lockdown_allow_remove':
    case 'disable_lockdown':
    case 'complete_setup_verification':
      return 'confirm';
    case 'upsert_report_instructions':
    case 'clear_report_instructions':
      return requirement(setupNeedsConfirmation(command));
    case 'preview_case_message_deletion':
    case 'execute_case_message_deletion':
    case 'ban_case_user_with_message_cleanup':
      return messageCleanupNeedsConfirmation(command) ? 'preview_confirm' : 'none';
    case 'quarantine_compromised_account':
      return 'preview_confirm';
    case 'request_captcha_challenge':
    case 'retry_captcha_challenge':
    case 'bypass_captcha_challenge':
    case 'open_submitted_report_case':
      return 'confirm';
    case 'preview_account_quarantine':
    case 'close_submitted_report':
    case 'acknowledge_attention':
      return 'none';
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
