import { mock, mockDeep } from 'jest-mock-extended';
import {
  ActionDeniedError,
  createReportActions,
  decodeQueuedAction,
  projectHumanOutcome,
  type ReportDependencies,
  type ReportIntakeState,
} from '@drasil/application';
import { dispatchReportAction } from '../../application/reportDispatch';
it('preserves a submitted report when final intake bookkeeping fails', async () => {
  const intake: ReportIntakeState = {
    id: 'intake',
    guildId: 'guild',
    reporterId: 'reporter',
    threadId: 'thread',
    status: 'needs_reporter_confirmation',
    confirmedTargetUserId: null,
    promptMessageId: 'prompt',
    promptToken: 'secret',
    candidateIds: ['target'],
    claimed: false,
  };
  const confirmedSubmission = jest.fn(async () => ({
    status: 'submitted' as const,
    targetUserId: 'target',
  }));
  const deps = mock<ReportDependencies>({
    intakes: {
      load: async () => intake,
      findOpen: async () => null,
      open: async () => intake,
      markOpenFailed: async () => {},
      confirm: async () => {
        intake.confirmedTargetUserId = 'target';
        return { confirmed: true, message: 'Confirmed', reason: 'Evidence' };
      },
      reject: async () => ({ rejected: false, message: 'No' }),
      close: async () => ({ closed: false, message: 'No' }),
      markSubmitted: async () => {
        throw new Error('write failed');
      },
    },
    submissions: {
      confirmed: confirmedSubmission,
      user: async () => ({ status: 'submitted', targetUserId: 'target' }),
      message: async () => ({ status: 'submitted' }),
    },
    threads: {
      notifySubmitted: async () => {},
      prepareClose: async () => ({ finish: async () => ({ archived: false, message: 'No' }) }),
      create: async () => null,
      activate: async () => false,
      deleteFailed: async () => {},
      notifyOpened: async () => {},
    },
  });
  const decoded = decodeQueuedAction({
    id: 'request',
    server_id: 'guild',
    actor_id: 'reporter',
    actor_surface: 'mcp',
    target_user_id: 'target',
    report_intake_id: 'intake',
    action_type: 'confirm_intake_candidate',
    metadata: {
      report_command: {
        intakeId: 'intake',
        threadId: 'thread',
        promptMessageId: 'prompt',
        targetUserId: 'target',
      },
    },
  });
  if (decoded.command.kind !== 'confirm_intake_candidate') throw new Error('wrong command');
  const actions = createReportActions(deps);
  const outcome = await dispatchReportAction(actions, decoded.context, decoded.command);
  expect(confirmedSubmission).toHaveBeenCalledTimes(1);
  expect(outcome).toMatchObject({ status: 'submitted', statusRecorded: false });
  expect(projectHumanOutcome(decoded.command, outcome)).toMatchObject({
    state: 'partial',
    outcome: { status: 'submitted', details: { statusRecorded: false } },
  });
  await expect(dispatchReportAction(actions, decoded.context, decoded.command)).rejects.toThrow();
  expect(confirmedSubmission).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(outcome)).not.toContain('secret');
});

import { prepareQueuedRequest } from '../../application/requestRuntime';

it.each([true, false])(
  'rechecks a report wrapper before the frozen case child (stale=%s)',
  async (stale) => {
    const execute = jest.fn(async () => ({
      kind: 'outcome',
      outcome: { kind: 'open_case_from_observed_detection', succeeded: true },
    }));
    const validate = jest.fn(async () => {
      if (stale) throw new ActionDeniedError('stale_state');
    });
    const request = {
      id: 'request',
      server_id: 'guild',
      actor_id: 'actor',
      actor_surface: 'mcp',
      target_user_id: 'target',
      detection_event_id: 'detection',
      report_intake_id: 'report',
      action_type: 'open_case_from_observed_detection',
      metadata: { report_intake_id: 'report' },
    };
    const execution = {
      workflowId: 'open_submitted_report_case',
      command: { kind: 'open_submitted_report_case', reportId: 'report' },
      executionId: 'execution',
    };
    const prepared = await prepareQueuedRequest({
      request: request as never,
      runtime: {
        cases: { execute },
        caseConfirmations: { recordVerified: jest.fn() },
        delegation: {
          authorizeDelegatedRequest: async () => ({ kind: 'new_execution', execution }),
          validateReportResources: validate,
          complete: jest.fn(),
        },
      } as never,
      analytics: {} as never,
    });
    const result = await prepared.execute();
    expect(validate).toHaveBeenCalledWith(execution);
    if (stale) {
      expect(result).toMatchObject({ state: 'denied', code: 'stale_state' });
      expect(execute).not.toHaveBeenCalled();
    } else {
      expect(execute).toHaveBeenCalledWith(expect.anything(), {
        kind: 'open_case_from_observed_detection',
        detectionEventId: 'detection',
        reportId: 'report',
        targetUserId: 'target',
      });
      expect(result).toMatchObject({ opened: true });
    }
  }
);

import {
  createBotDetectionRuntime,
  type BotDetectionDependencies,
} from '../../application/adapters/detections';
import { dispatchDetectionAction } from '../../application/detectionDispatch';

import type { ModerationActionRequest } from '../../repositories/types';
it('delivers portable review with fresh ban authority and never enforces another ban', async () => {
  const deps = mockDeep<BotDetectionDependencies>();
  let permissions = '4';
  const authority = {
    loadFresh: async () => ({
      guildId: 'guild',
      userId: 'actor',
      present: true,
      owner: false,
      permissions,
      roleIds: [],
    }),
  };
  deps.confirmations.verify.mockResolvedValue(true);
  deps.actionRequests.findById.mockResolvedValue({
    id: 'operation',
    server_id: 'guild',
    target_user_id: 'target',
    detection_event_id: 'detection',
    action_type: 'ban_observed_detection',
    metadata: { report_ban_phase: 'reconciliation_required' },
    result: { observed_ban_result: { status: 'ban_outcome_unknown' } },
  } as unknown as ModerationActionRequest);
  const reference = {
    operationId: 'operation',
    targetUserId: 'target',
    attemptToken: 'secret',
    updatedAt: new Date(),
  };
  const claim = jest.fn(async () => reference);
  const reviews = { claim, load: jest.fn(), save: jest.fn() };
  const runtime = createBotDetectionRuntime(
    Object.assign(deps, { reviewReferences: reviews }),
    authority
  );
  const request = {
    id: 'review-request',
    actor_surface: 'mcp',
    metadata: { delegation: { executionId: 'execution' } },
  } as unknown as ModerationActionRequest;
  const context = {
    guildId: 'guild',
    requestId: 'review-request',
    source: 'mcp',
    actor: { kind: 'user' as const, userId: 'actor' },
  };
  const command = {
    kind: 'review_uncertain_report_ban' as const,
    operationId: 'operation',
    targetUserId: 'target',
    reviewReference: 'handle',
    reason: 'No current ban',
  };
  expect(await dispatchDetectionAction(runtime.forRequest(request), context, command)).toEqual({
    action_type: command.kind,
    succeeded: true,
  });
  expect(deps.securityActionService.reviewUncertainReportBan).toHaveBeenCalledTimes(1);
  expect(deps.securityActionService.banObservedDetection).not.toHaveBeenCalled();
  permissions = '0';
  await expect(
    dispatchDetectionAction(runtime.forRequest(request), context, command)
  ).rejects.toThrow();
  expect(deps.securityActionService.reviewUncertainReportBan).toHaveBeenCalledTimes(1);
  expect(claim).toHaveBeenCalledTimes(2);
});
