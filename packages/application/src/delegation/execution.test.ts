import { createDelegatedActionService, projectExecution, projectHumanOutcome } from './execution';
import { ActionDeniedError } from '../results';
import type { DelegatedAccess } from './access';
import type { DelegatedPrincipal, DelegationStore, ExecutionRecord, IntentRecord } from './types';
it.each([
  ['ambiguous_case_role', 'denied'],
  ['ambiguous_verification_channel', 'denied'],
  ['invalid_selection', 'denied'],
  ['candidate_validation_failed', 'failed'],
  ['verification_channel_failed', 'uncertain'],
  ['final_validation_failed', 'uncertain'],
  ['config_save_failed', 'uncertain'],
] as const)('projects only safe setup %s diagnostics', (code, state) => {
  const result = projectHumanOutcome({ kind: 'complete_setup_verification' } as never, {
    action_type: 'complete_setup_verification',
    code,
    status: state,
    error_count: 2,
    warning_count: -1,
    diagnostic_code: 'private unknown diagnostic',
    setupFailureDetail: 'private rollback prose',
    error: 'private raw error',
  });
  expect(result).toMatchObject({ state, code, outcome: { details: { error_count: 2 } } });
  expect(result.outcome?.details).not.toHaveProperty('warning_count');
  expect(result.outcome?.details).not.toHaveProperty('diagnostic_code');
  expect(JSON.stringify(result)).not.toContain('private');
});
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

it.each(['before_write', 'after_write', 'denied_effect'] as const)(
  'returns an owned uncertain receipt on completion failure %s without replaying the effect',
  async (failure) => {
    const principal: DelegatedPrincipal = {
      userId: 'actor',
      clientId: 'client',
      connectionId: 'connection',
      grantVersion: 1,
      scopes: ['drasil:read', 'drasil:moderate'],
    };
    let intent: IntentRecord | null = null;
    let execution: ExecutionRecord | null = null;
    const store: Pick<
      DelegationStore,
      | 'saveIntent'
      | 'findIntentByKey'
      | 'loadIntent'
      | 'acceptIntent'
      | 'loadExecution'
      | 'startDirectExecution'
      | 'completeExecution'
    > = {
      saveIntent: async (_p, value) => (intent = value),
      findIntentByKey: async () => intent,
      loadIntent: async () => intent,
      acceptIntent: async (_p, _id, method) => {
        if (execution) return execution;
        execution = {
          ...intent!,
          executionId: 'durable-execution',
          confirmationMethod: method,
          queueRequestId: null,
          startedAt: null,
          completedAt: null,
          outcome: null,
        };
        intent = { ...intent!, state: 'consumed', executionId: execution.executionId };
        return execution;
      },
      loadExecution: async (p, id) =>
        p.connectionId === principal.connectionId && execution?.executionId === id
          ? execution
          : null,
      startDirectExecution: jest.fn(async () => {
        execution = { ...execution!, startedAt: new Date() };
        return { kind: 'new_execution' as const, execution };
      }),
      completeExecution: jest.fn(async (_id, result) => {
        if (failure === 'after_write')
          execution = {
            ...execution!,
            completedAt: new Date(),
            outcome: { kind: 'delegated_terminal', result },
          };
        // Even a typed denial at this persistence boundary cannot prove no effect committed.
        throw new ActionDeniedError('permission_denied', 'private persistence detail');
      }),
    };
    const execute = jest.fn(async () => {
      if (failure === 'denied_effect')
        throw new ActionDeniedError('permission_denied', 'private effect detail');
      return {
        kind: 'attention_batch' as const,
        items: [{ itemId: 'one', state: 'completed' as const }],
      };
    });
    const service = createDelegatedActionService({
      store: store as DelegationStore,
      access: {
        authorizeWorkflowId: async () => ({ kind: 'allowed' }),
        authorizeWorkflow: async () => ({ kind: 'allowed' }),
        authorizeRead: async () => ({ kind: 'allowed' }),
      } as unknown as DelegatedAccess,
      resolver: {
        resolve: async () => ({
          delivery: { kind: 'direct' },
          preconditions: { kind: 'none' },
          relevantState: {},
          summary: 'Acknowledge item one',
          previewExpiresAt: null,
        }),
      },
      direct: { execute },
    });
    const invocation = {
      workflowId: 'acknowledge_attention' as const,
      guildId: 'guild',
      idempotencyKey: 'once',
      input: { itemIds: ['one'] },
    };
    const result = await service.submit(principal, invocation);
    const binding = {
      executionId: 'durable-execution',
      operation: 'acknowledge_attention',
      guildId: 'guild',
    };
    expect(result).toMatchObject({
      ...binding,
      state: 'uncertain',
      code: 'completion_recording_failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    const recovered = { ...binding, state: failure === 'after_write' ? 'completed' : 'uncertain' };
    expect(await service.status(principal, 'durable-execution')).toMatchObject(recovered);
    expect(
      await service.status({ ...principal, connectionId: 'other' }, 'durable-execution')
    ).toEqual({ state: 'denied', code: 'not_found' });
    expect(await service.submit(principal, invocation)).toMatchObject(recovered);
    expect(
      await service.confirm(principal, intent!.confirmationId, 'client_confirmation')
    ).toMatchObject(recovered);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.startDirectExecution).toHaveBeenCalledTimes(1);
    expect(store.completeExecution).toHaveBeenCalledTimes(1);
  }
);
