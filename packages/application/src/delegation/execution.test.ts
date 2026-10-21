import { projectExecution, projectHumanOutcome } from './execution';
import type { ExecutionRecord } from './types';
it('projects a started direct execution as uncertain without disclosing private bindings', () => {
  const execution = {
    executionId: 'execution',
    guildId: 'guild',
    workflowId: 'acknowledge_attention',
    command: { kind: 'acknowledge_attention', itemIds: ['one'] },
    queueRequestId: null,
    startedAt: new Date(),
    completedAt: null,
    outcome: null,
    preconditions: { secret: 'private' },
    connectionId: 'connection',
    confirmationId: 'private',
  } as unknown as ExecutionRecord;
  expect(projectExecution(execution)).toEqual({
    state: 'uncertain',
    executionId: 'execution',
    operation: 'acknowledge_attention',
    guildId: 'guild',
    retryAfterMs: 2000,
  });
});
it('retains partial cleanup and unknown enforcement without internal fields', () => {
  expect(
    projectHumanOutcome(
      { kind: 'close_submitted_report', reportId: 'report', action: 'mark_actioned' },
      { status: 'closed', queueCleanupStatus: 'failed', actor: { id: 'private' } }
    )
  ).toEqual({ state: 'partial', outcome: { status: 'closed', queueCleanupStatus: 'failed' } });
  expect(
    projectHumanOutcome({ kind: 'ban_observed_detection' } as never, {
      observed_ban_result: { status: 'ban_outcome_unknown', enforcementId: 'private' },
      report_ban_attempt_token: 'private',
    })
  ).toEqual({ state: 'uncertain', outcome: { status: 'ban_outcome_unknown' } });
});
it.each([
  [
    { kind: 'execute_case_message_deletion' },
    { deleted_count: 2, delete_failed_count: 1 },
    'partial',
  ],
  [
    { kind: 'quarantine_compromised_account' },
    { parked: false, failed_role_removals: 1 },
    'partial',
  ],
  [{ kind: 'intake_role_members' }, { opened: 2, failed: 1 }, 'partial'],
  [{ kind: 'apply_case_role_lockdown' }, { applied_writes: 2, failed_writes: 1 }, 'partial'],
  [{ kind: 'close_resolved_case_threads' }, { closed_threads: 2, failed_threads: 1 }, 'partial'],
  [{ kind: 'request_captcha_challenge' }, { delivered: false }, 'partial'],
  [
    { kind: 'complete_setup_verification' },
    { report_instructions_error: 'secret raw error' },
    'partial',
  ],
  [
    { kind: 'clear_moderation_queue' },
    { action_type: 'delegated_admission', state: 'denied', code: 'permission_denied' },
    'denied',
  ],
] as const)('preserves failure state for %j', (command, outcome, state) => {
  expect(projectHumanOutcome(command as never, outcome).state).toBe(state);
  expect(JSON.stringify(projectHumanOutcome(command as never, outcome))).not.toContain(
    'secret raw error'
  );
});
it('limits native enforcement receipts to their own effect even if a worker includes staff fields', () => {
  expect(
    projectHumanOutcome({ kind: 'ban_user' } as never, {
      banned: true,
      case_role_active: true,
      closed_count: 8,
      verification_event_id: 'private',
      thread_id: 'private',
    })
  ).toEqual({ state: 'completed', outcome: { details: { banned: true } } });
});
it('preserves a report-open child outcome in its parent receipt', () => {
  expect(
    projectHumanOutcome(
      { kind: 'open_submitted_report_case', reportId: 'report' },
      {
        action_type: 'open_case_from_observed_detection',
        opened: false,
        target_user_id: 'target',
        detection_event_id: 'private',
      }
    )
  ).toEqual({ state: 'completed', outcome: { details: { opened: false } } });
});
