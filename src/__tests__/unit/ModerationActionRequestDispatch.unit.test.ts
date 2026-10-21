import {
  decodeQueuedAction,
  encodeQueuedAction,
  queuedCommandSchemas,
  type QueuedCommand,
  type QueuedJson,
} from '@drasil/application';
import {
  prepareQueuedAction,
  queuedActionHandlers,
  type QueuedRequestRuntime,
} from '../../application/requestDispatch';
import { mock } from 'jest-mock-extended';
import {
  ModerationActionRequestType,
  type ModerationActionRequest,
} from '../../repositories/types';

// Stored-row fixtures are independent of the encoder. All persisted enum values
// must decode, reach their owning family, and retain the receipt/storage projection.
interface Fixture {
  family:
    | 'cases'
    | 'detections'
    | 'quarantine'
    | 'captcha'
    | 'messageCleanup'
    | 'operations'
    | 'reports'
    | 'setupRuntime';
  metadata?: Record<string, QueuedJson>;
  outcome: unknown;
  source?: string;
  target?: null;
}
const succeeded = { succeeded: true };
const count = { count: 2 };
const cleanupJob = {
  id: 'job',
  mode: 'delete_only',
  scope: 'last_hour',
  status: 'preview_ready',
  generation: '2026-10-20T00:00:00.000Z',
  candidateCount: 3,
  coverage: 'complete',
  targetUserId: 'target',
  caseId: 'case',
};
const cleanupCounts = {
  job: cleanupJob,
  alreadyCompleted: false,
  preservedCount: 3,
  deletedCount: 2,
  alreadyMissingCount: 1,
  changedCount: 0,
  evidenceFailedCount: 0,
  deleteFailedCount: 0,
  permissionDeniedCount: 0,
};
const cleanupMetadata = {
  cleanup_mode: 'delete_only',
  cleanup_scope: 'last_hour',
  reason: 'Reviewed',
  cleanup_preview_generation: '2026-10-20T00:00:00.000Z',
};
const lockdown = {
  appliedActions: [],
  enabled: true,
  errorCount: 0,
  failedActions: [],
  issues: [],
  plannedActions: [],
  syncedAllowedChannels: [],
  unsyncedAllowedChannels: [],
  warningCount: 0,
};
const captchaReceipt = {
  challenge_id: 'challenge',
  generation: 2,
  target_user_id: 'target',
  verification_event_id: 'case',
};
const fixtures = {
  update_settings: {
    family: 'setupRuntime',
    target: null,
    metadata: {
      setup_command: {
        kind: 'update_settings',
        section: 'caseStaff',
        changes: { case_responder_role_ids: [] },
      },
    },
    outcome: {},
  },
  update_heuristics: {
    family: 'setupRuntime',
    target: null,
    metadata: { setup_command: { kind: 'update_heuristics', changes: { messageThreshold: 8 } } },
    outcome: {},
  },
  reset_heuristics: {
    family: 'setupRuntime',
    target: null,
    metadata: { setup_command: { kind: 'reset_heuristics', scope: 'keywords' } },
    outcome: {},
  },
  lockdown_allow_add: {
    family: 'setupRuntime',
    target: null,
    metadata: {
      setup_command: { kind: 'lockdown_allow_add', targetKind: 'category', targetId: 'category' },
    },
    outcome: {},
  },
  lockdown_allow_remove: {
    family: 'setupRuntime',
    target: null,
    metadata: {
      setup_command: { kind: 'lockdown_allow_remove', targetKind: 'channel', targetId: 'channel' },
    },
    outcome: {},
  },
  disable_lockdown: {
    family: 'setupRuntime',
    target: null,
    metadata: { setup_command: { kind: 'disable_lockdown' } },
    outcome: {},
  },
  clear_report_instructions: {
    family: 'setupRuntime',
    target: null,
    metadata: { setup_command: { kind: 'clear_report_instructions' } },
    outcome: {},
  },
  audit_integrity: {
    family: 'operations',
    target: null,
    metadata: {
      operation_command: {
        kind: 'audit_integrity',
        scope: 'all',
        days: 30,
        limit: 100,
        userId: null,
      },
    },
    outcome: {
      report: {
        findings: [{ severity: 'warning' }],
        candidateCounts: { pendingCases: 2, recentResolvedCases: 3 },
      },
    },
  },
  open_case_from_observed_detection: {
    family: 'cases',
    metadata: { inbox_action: 'open_case', reason: null, requested_surface: 'web' },
    outcome: succeeded,
  },
  open_admin_case: {
    family: 'cases',
    metadata: { reason: 'Reviewed', requested_surface: 'web', web_action: 'open_admin_case' },
    outcome: { result: { opened: true, caseRoleActive: true, caseRoleAttempted: true } },
  },
  manual_flag_user: { family: 'cases', metadata: { reason: 'Reviewed' }, outcome: succeeded },
  verify_case_user: { family: 'cases', outcome: succeeded },
  close_case_no_action: { family: 'cases', outcome: count },
  kick_case_user: { family: 'cases', metadata: { reason: 'Reviewed' }, outcome: succeeded },
  ban_case_user: { family: 'cases', metadata: { reason: 'Reviewed' }, outcome: succeeded },
  ban_case_user_by_id: { family: 'cases', metadata: { reason: 'Reviewed' }, outcome: succeeded },
  repair_active_case: {
    family: 'cases',
    metadata: { case_action: 'create_thread' },
    outcome: { result: { message: 'Repaired', repaired: true, threadCreated: true } },
  },
  reopen_case: { family: 'cases', outcome: succeeded },
  refresh_case_notification: {
    family: 'cases',
    outcome: { result: { message: 'Refreshed', refreshed: true } },
  },
  sync_existing_ban: { family: 'cases', outcome: count },
  dismiss_observed_detection: { family: 'detections', outcome: succeeded },
  mark_observed_detection_false_positive: { family: 'detections', outcome: succeeded },
  undo_observed_detection_action: { family: 'detections', outcome: { undoneAction: 'dismiss' } },
  kick_observed_detection: {
    family: 'detections',
    metadata: { reason: 'Reviewed' },
    outcome: succeeded,
  },
  ban_observed_detection: {
    family: 'detections',
    source: 'web_report',
    metadata: { reason: 'Reviewed', report_ban_attempt_token: 'private' },
    outcome: {
      result: { status: 'banned_updates_pending', operationId: 'request' },
      banById: true,
    },
  },
  ignore_detection_accounting: {
    family: 'detections',
    source: 'discord_interaction',
    outcome: succeeded,
  },
  restore_detection_accounting: {
    family: 'detections',
    source: 'discord_interaction',
    outcome: succeeded,
  },
  preview_account_quarantine: {
    family: 'quarantine',
    outcome: {
      preview: {
        enabled: true,
        canContain: true,
        caseRoleId: 'role',
        lockdown,
        memberAudit: { bypasses: [], unremovablePrivilegeReasons: [] },
        rolePreview: { plannedRoleIds: ['member'], privilegedRoleIds: [], skippedRoles: [] },
      },
      readiness: {
        recoveryThreadReady: true,
        adminNotificationReady: true,
        recoveryThreadId: 'thread',
      },
      fingerprint: 'fingerprint',
      roleNames: { role: 'Case', member: 'Member' },
    },
  },
  quarantine_compromised_account: {
    family: 'quarantine',
    metadata: { preview_request_id: 'preview', reason: 'Reviewed' },
    outcome: {
      status: 'parked',
      containmentStatus: 'contained',
      failedRoleRemovals: 0,
      memberBypasses: 0,
      retainedRoles: 0,
      recovered: true,
    },
  },
  request_captcha_challenge: { family: 'captcha', outcome: { ...captchaReceipt, delivered: true } },
  retry_captcha_challenge: {
    family: 'captcha',
    metadata: { expected_challenge_id: 'challenge', expected_generation: 2 },
    outcome: { ...captchaReceipt, delivered: true },
  },
  bypass_captcha_challenge: {
    family: 'captcha',
    metadata: { expected_challenge_id: 'challenge', expected_generation: 2, reason: 'Reviewed' },
    outcome: { ...captchaReceipt, bypassed: true },
  },
  apply_captcha_pass: {
    family: 'captcha',
    source: 'captcha',
    metadata: { challenge_id: 'challenge', generation: 2, expected_case_revision: 3 },
    outcome: { ...captchaReceipt, effect: 'verify', held_reason: null, resolved: true },
  },
  notify_captcha_attention: {
    family: 'captcha',
    source: 'captcha',
    metadata: { challenge_id: 'challenge', generation: 2, reason: 'expired' },
    outcome: { ...captchaReceipt, reason: 'expired', notified: true },
  },
  preview_case_message_deletion: {
    family: 'messageCleanup',
    metadata: cleanupMetadata,
    outcome: { job: cleanupJob },
  },
  execute_case_message_deletion: {
    family: 'messageCleanup',
    metadata: cleanupMetadata,
    outcome: cleanupCounts,
  },
  ban_case_user_with_message_cleanup: {
    family: 'messageCleanup',
    metadata: { ...cleanupMetadata, cleanup_mode: 'ban_with_cleanup' },
    outcome: {
      ...cleanupCounts,
      job: { ...cleanupJob, mode: 'ban_with_cleanup' },
      banned: true,
      caseFinalized: true,
    },
  },
  sync_moderation_queue: { family: 'operations', target: null, outcome: {} },
  clear_moderation_queue: { family: 'operations', target: null, outcome: { removedCount: 3 } },
  close_resolved_case_threads: {
    family: 'operations',
    target: null,
    metadata: { execute: false, days: 30, limit: 100 },
    outcome: {
      report: {
        alreadyClosedThreads: 1,
        checkedCases: 5,
        checkedThreads: 4,
        closedThreads: 0,
        days: 30,
        execute: false,
        failedThreads: 0,
        limit: 100,
        missingThreads: 1,
        wouldCloseThreads: 3,
      },
    },
  },
  audit_case_role_lockdown: { family: 'operations', target: null, outcome: { report: lockdown } },
  apply_case_role_lockdown: {
    family: 'operations',
    target: null,
    metadata: { unsync_allowed_channels: true },
    outcome: { report: lockdown },
  },
  intake_role_members: {
    family: 'operations',
    target: null,
    metadata: { role_id: 'role', execute: false },
    outcome: {
      result: {
        batchId: 'batch',
        eligibleMembers: 2,
        execute: false,
        failed: 0,
        failures: [],
        opened: 0,
        processed: 2,
        roleId: 'role',
        roleName: 'Role',
        skippedActiveCases: 0,
        skippedBots: 1,
        skippedOverLimit: 0,
        totalMembers: 3,
      },
    },
  },
  submit_user_report: {
    family: 'reports',
    metadata: { target_label: 'Target', reason: 'Reviewed' },
    outcome: { result: { status: 'submitted', targetUserId: 'target' } },
  },
  start_report_intake: {
    family: 'reports',
    target: null,
    metadata: { channel_id: 'channel' },
    outcome: {
      intake: { id: 'report', threadId: 'thread' },
      status: 'opened',
      threadUrl: 'https://discord.com/channels/guild/thread',
    },
  },
  close_report_intake: {
    family: 'reports',
    target: null,
    outcome: {
      intake: { id: 'report', threadId: 'thread' },
      result: { closed: true, message: 'Closed' },
      archived: true,
    },
  },
  complete_setup_verification: {
    family: 'setupRuntime',
    target: null,
    metadata: { admin_channel_id: 'admin', case_role_id: 'role', onboarding_wizard: false },
    outcome: {
      result: {
        status: 'completed',
        adminChannelId: 'admin',
        caseRoleWasCreated: false,
        caseRoleId: 'role',
        verificationChannelAction: 'created',
        verificationChannelId: 'verification',
      },
    },
  },
  upsert_report_instructions: {
    family: 'setupRuntime',
    target: null,
    metadata: { channel_id: 'channel' },
    outcome: { result: { action: 'updated', messageId: 'message' } },
  },
} satisfies Record<
  Exclude<
    QueuedCommand['kind'],
    | 'ban_user'
    | 'kick_user'
    | 'submit_message_report'
    | 'confirm_intake_candidate'
    | 'reject_intake_candidates'
    | 'prepare_report_ban_review'
    | 'review_uncertain_report_ban'
  >,
  Fixture
>;

const kinds = Object.keys(fixtures) as (keyof typeof fixtures)[];
it('has exact schema, handler and shipped database enum coverage', () => {
  const expected = Object.values(ModerationActionRequestType).sort();
  expect(expected).toHaveLength(55);
  expect(kinds).toHaveLength(48);
  expect(Object.keys(queuedCommandSchemas).sort()).toEqual(expected);
  expect(Object.keys(queuedActionHandlers).sort()).toEqual(expected);
  expect(
    [
      ...kinds,
      'ban_user',
      'kick_user',
      'submit_message_report',
      'confirm_intake_candidate',
      'reject_intake_candidates',
      'prepare_report_ban_review',
      'review_uncertain_report_ban',
    ].sort()
  ).toEqual(expected);
});
it.each(kinds)('decodes and dispatches the shipped %s row with its receipt', async (kind) => {
  jest.useFakeTimers().setSystemTime(new Date('2026-10-20T00:00:00.000Z'));
  try {
    const fixture: Fixture = fixtures[kind];
    const request = {
      ...mock<ModerationActionRequest>({
        id: 'request',
        action_type: kind as ModerationActionRequestType,
        server_id: 'guild',
        actor_surface: fixture.source ?? 'web',
        actor_id: fixture.source === 'captcha' ? 'drasil:captcha' : 'moderator',
        target_user_id: fixture.target === null ? null : 'target',
        detection_event_id: 'detection',
        verification_event_id: 'case',
        report_intake_id: kind === 'close_report_intake' ? 'report' : null,
        message_deletion_job_id: 'job',
      }),
      metadata: fixture.metadata ?? {},
    };
    const action = decodeQueuedAction(request);
    expect(queuedCommandSchemas[kind].safeParse(action.command).success).toBe(true);
    expect(JSON.stringify(action)).not.toContain('private');
    const encoded = encodeQueuedAction(
      fixture.source === 'captcha'
        ? {
            ...action.context,
            actor: {
              kind: 'system',
              purpose: kind === 'apply_captcha_pass' ? 'captcha_pass' : 'captcha_attention',
            },
          }
        : action.context,
      action.command
    );
    expect(encoded).toMatchSnapshot('storage');
    const execute = jest.fn().mockResolvedValue({
      kind: 'outcome',
      outcome: {
        ...(fixture.outcome as object),
        ...(fixture.family === 'captcha' ? { action_type: kind } : { kind }),
      },
    });
    const forRequest = jest.fn().mockReturnValue({ execute, preview: execute });
    const factory = {
      detections: 'detectionRuntime',
      quarantine: 'quarantineRuntime',
      captcha: 'captchaRuntime',
      messageCleanup: 'messageCleanupRuntime',
      cases: null,
      operations: null,
      reports: null,
      setupRuntime: null,
    }[fixture.family];
    const runtime = (factory
      ? { [factory]: { forRequest } }
      : { [fixture.family]: { execute, preview: execute } }) as unknown as QueuedRequestRuntime;
    const prepared = prepareQueuedAction({ runtime, action, request });
    expect(execute).not.toHaveBeenCalled();
    if (factory) expect(forRequest).toHaveBeenCalledWith(request);
    const receipt = await prepared();
    expect(forRequest).toHaveBeenCalledTimes(factory ? 1 : 0);
    expect(receipt).toMatchSnapshot('receipt');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual(action.context);
    expect(execute.mock.calls[0][1]).toEqual(action.command);
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  {
    kind: 'submit_message_report',
    report_command: {
      targetUserId: 'target',
      channelId: 'channel',
      messageId: 'message',
      reason: null,
    },
    outcome: { status: 'submitted', result: { status: 'submitted' } },
  },
  {
    kind: 'confirm_intake_candidate',
    report_command: {
      intakeId: 'report',
      threadId: 'thread',
      promptMessageId: 'prompt',
      targetUserId: 'target',
    },
    outcome: { status: 'submitted', statusRecorded: false },
  },
  {
    kind: 'reject_intake_candidates',
    report_command: {
      intakeId: 'report',
      threadId: 'thread',
      promptMessageId: 'prompt',
      promptToken: 'token',
    },
    outcome: { status: 'not_rejected', result: { rejected: false, message: 'Changed' } },
  },
])(
  'dispatches new report $kind preserving domain status',
  async ({ kind, report_command, outcome }) => {
    const request = mock<ModerationActionRequest>({
      id: 'request',
      server_id: 'guild',
      actor_id: 'reporter',
      actor_surface: 'mcp',
      action_type: kind as ModerationActionRequestType,
      target_user_id: 'target',
      report_intake_id: 'report',
      detection_event_id: null,
      verification_event_id: null,
      message_deletion_job_id: null,
      metadata: { report_command: JSON.parse(JSON.stringify(report_command)) },
    });
    const action = decodeQueuedAction(request);
    const execute = jest.fn().mockResolvedValue({ kind: 'outcome', outcome: { kind, ...outcome } });
    const receipt = await prepareQueuedAction({
      request,
      action,
      runtime: { reports: { execute } } as unknown as QueuedRequestRuntime,
    })();
    expect(receipt).toMatchObject({
      action_type: kind,
      status: outcome.status,
      ...('statusRecorded' in outcome ? { statusRecorded: outcome.statusRecorded } : {}),
    });
  }
);
