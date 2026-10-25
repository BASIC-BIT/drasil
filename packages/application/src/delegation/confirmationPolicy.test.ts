import { confirmationRequirement } from './confirmationPolicy';
import { workflowDefinitions, type HumanCommand } from './commands';

// Independent confirmation inventory: each variant and each conditional execution flag.
const expected = {
  ban_user: 'confirm',
  kick_user: 'confirm',
  open_case_from_observed_detection: 'confirm',
  manual_flag_user: 'confirm',
  verify_case_user: 'confirm',
  close_case_no_action: 'confirm',
  kick_case_user: 'confirm',
  ban_case_user: 'confirm',
  ban_case_user_by_id: 'confirm',
  reopen_case: 'confirm',
  refresh_case_notification: 'none',
  sync_existing_ban: 'confirm',
  open_admin_case_moderator: 'confirm',
  open_admin_case_administrator: 'confirm',
  repair_active_case_moderator: 'confirm',
  repair_active_case_administrator: 'none',
  dismiss_observed_detection: 'confirm',
  mark_observed_detection_false_positive: 'confirm',
  undo_observed_detection_action: 'confirm',
  kick_observed_detection: 'confirm',
  ignore_detection_accounting: 'confirm',
  restore_detection_accounting: 'confirm',
  prepare_report_ban_review: 'none',
  review_uncertain_report_ban: 'preview_confirm',
  ban_observed_detection_observed: 'confirm',
  ban_observed_detection_report: 'confirm',
  sync_moderation_queue: 'none',
  clear_moderation_queue: 'confirm',
  audit_case_role_lockdown: 'none',
  apply_case_role_lockdown: 'confirm',
  intake_role_members: 'none',
  audit_integrity: 'none',
  close_resolved_case_threads_guild_audit: 'none',
  close_resolved_case_threads_administrator: 'none',
  submit_user_report: 'confirm',
  start_report_intake: 'none',
  close_report_intake: 'confirm',
  submit_message_report: 'confirm',
  confirm_intake_candidate: 'confirm',
  reject_intake_candidates: 'none',
  update_settings: 'confirm',
  update_setup: 'confirm',
  update_heuristics: 'confirm',
  reset_heuristics: 'confirm',
  lockdown_allow_add: 'confirm',
  lockdown_allow_remove: 'confirm',
  disable_lockdown: 'confirm',
  complete_setup_verification_provision: 'confirm',
  complete_setup_verification_verification_modal: 'confirm',
  upsert_report_instructions_repair: 'none',
  upsert_report_instructions_repost: 'confirm',
  clear_report_instructions: 'none',
  preview_case_message_deletion: 'none',
  execute_case_message_deletion: 'preview_confirm',
  ban_case_user_with_message_cleanup: 'preview_confirm',
  preview_account_quarantine: 'none',
  quarantine_compromised_account: 'preview_confirm',
  request_captcha_challenge: 'confirm',
  retry_captcha_challenge: 'confirm',
  bypass_captcha_challenge: 'confirm',
  close_submitted_report: 'none',
  open_submitted_report_case: 'confirm',
  acknowledge_attention: 'none',
} as const;
it('covers all 63 workflows and their existing confirmation requirements', () => {
  expect(Object.keys(expected)).toHaveLength(63);
  for (const workflow of workflowDefinitions) {
    const command = {
      ...workflow.authorityCommand,
      mode: workflow.id.endsWith('verification_modal') ? 'verification_modal' : 'provision',
      repost: workflow.id.endsWith('_repost'),
      execute: false,
    } as HumanCommand;
    expect([workflow.id, confirmationRequirement(command)]).toEqual([
      workflow.id,
      expected[workflow.id],
    ]);
    if (command.kind === 'intake_role_members' || command.kind === 'close_resolved_case_threads') {
      expect(confirmationRequirement({ ...command, execute: true })).toBe('confirm');
    }
  }
});
