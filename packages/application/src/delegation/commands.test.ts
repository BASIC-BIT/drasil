import { z } from 'zod';
import { humanCommandSchema, workflowDefinitions, internalWorkflowExclusions } from './commands';
import { caseCommandSchema } from '../cases/commands';
import { detectionCommandSchema } from '../detections/commands';
import { operationCommandSchema } from '../operations/commands';
import { reportCommandSchema } from '../reports/commands';
import { setupCommandSchema } from '../setup/commands';
import { messageCleanupCommandSchema } from '../messageCleanup/commands';
import { queuedQuarantineCommandSchema } from '../containment/commands';
import { captchaCommandSchema } from '../containment/captcha';

function kinds(schema: z.ZodTypeAny): string[] {
  if (schema instanceof z.ZodObject) return [schema.shape.kind.value];
  if (schema instanceof z.ZodUnion || schema instanceof z.ZodDiscriminatedUnion)
    return schema.options.flatMap(kinds);
  throw new Error('Unrecognized canonical schema');
}

it('covers every canonical human command and the independent caller inventory', () => {
  const canonicalKinds = new Set(
    [
      caseCommandSchema,
      detectionCommandSchema,
      operationCommandSchema,
      reportCommandSchema,
      setupCommandSchema,
      messageCleanupCommandSchema,
      queuedQuarantineCommandSchema,
      captchaCommandSchema,
    ]
      .flatMap(kinds)
      .filter((kind) => !['apply_captcha_pass', 'notify_captcha_attention'].includes(kind))
  );
  const actualKinds = new Set<string>(workflowDefinitions.map((workflow) => workflow.commandKind));
  expect(actualKinds).toEqual(
    new Set([
      ...canonicalKinds,
      'close_submitted_report',
      'open_submitted_report_case',
      'acknowledge_attention',
    ])
  );
  // Independent checklist from docs/dev/action-boundary-inventory.md and the approved MCP coverage table.
  const callers = new Set([
    'ban_user',
    'kick_user',
    'open_case_from_observed_detection',
    'open_admin_case',
    'manual_flag_user',
    'verify_case_user',
    'close_case_no_action',
    'kick_case_user',
    'ban_case_user',
    'ban_case_user_by_id',
    'repair_active_case',
    'reopen_case',
    'refresh_case_notification',
    'sync_existing_ban',
    'dismiss_observed_detection',
    'mark_observed_detection_false_positive',
    'undo_observed_detection_action',
    'kick_observed_detection',
    'ban_observed_detection',
    'ignore_detection_accounting',
    'restore_detection_accounting',
    'prepare_report_ban_review',
    'review_uncertain_report_ban',
    'submit_user_report',
    'submit_message_report',
    'start_report_intake',
    'close_report_intake',
    'confirm_intake_candidate',
    'reject_intake_candidates',
    'close_submitted_report',
    'open_submitted_report_case',
    'acknowledge_attention',
    'request_captcha_challenge',
    'retry_captcha_challenge',
    'bypass_captcha_challenge',
    'preview_account_quarantine',
    'quarantine_compromised_account',
    'preview_case_message_deletion',
    'execute_case_message_deletion',
    'ban_case_user_with_message_cleanup',
    'sync_moderation_queue',
    'clear_moderation_queue',
    'close_resolved_case_threads',
    'audit_case_role_lockdown',
    'apply_case_role_lockdown',
    'intake_role_members',
    'audit_integrity',
    'update_settings',
    'update_setup',
    'update_heuristics',
    'reset_heuristics',
    'lockdown_allow_add',
    'lockdown_allow_remove',
    'disable_lockdown',
    'complete_setup_verification',
    'upsert_report_instructions',
    'clear_report_instructions',
  ]);
  expect(actualKinds).toEqual(callers);
});

it('distinguishes authority and delivery variants without client provenance', () => {
  const ids = workflowDefinitions.map((workflow) => workflow.id);
  for (const id of [
    'open_admin_case_moderator',
    'open_admin_case_administrator',
    'repair_active_case_moderator',
    'repair_active_case_administrator',
    'close_resolved_case_threads_guild_audit',
    'close_resolved_case_threads_administrator',
    'complete_setup_verification_provision',
    'complete_setup_verification_verification_modal',
    'ban_observed_detection_observed',
    'ban_observed_detection_report',
    'upsert_report_instructions_repair',
    'upsert_report_instructions_repost',
    'acknowledge_attention',
  ])
    expect(ids).toContain(id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    workflowDefinitions
      .find((workflow) => workflow.id === 'ban_user')
      ?.parseCommand({
        targetUserId: '999999999999999999',
        reason: null,
      })
  ).toEqual({
    kind: 'ban_user',
    targetUserId: '999999999999999999',
    reason: null,
    intent: 'native_action',
    selectedMessage: null,
  });
});

it.each([
  'apply_captcha_pass',
  'notify_captcha_attention',
  'reconcile_report_ban',
  'automatic_detection',
  'lifecycle_bookkeeping',
  'global_watchlist_administration',
  'discord_passthrough',
])('excludes internal workflow %s', (kind) => {
  expect(humanCommandSchema.safeParse({ kind }).success).toBe(false);
  expect(internalWorkflowExclusions.some((entry) => entry.kind === kind)).toBe(true);
});

it('parses report closure and attention wrappers strictly', () => {
  expect(
    humanCommandSchema.parse({
      kind: 'close_submitted_report',
      reportId: 'r',
      action: 'mark_actioned',
    })
  ).toEqual({ kind: 'close_submitted_report', reportId: 'r', action: 'mark_actioned' });
  expect(
    humanCommandSchema.safeParse({ kind: 'acknowledge_attention', itemIds: ['one'], actor: {} })
      .success
  ).toBe(false);
});

it.each([
  [
    'open_admin_case_moderator',
    { targetUserId: '123', reason: null, detectionEventId: null, selectedMessage: null },
    'intent',
    'native_case_open',
  ],
  [
    'open_admin_case_administrator',
    { targetUserId: '123', reason: null, detectionEventId: null, selectedMessage: null },
    'intent',
    'dashboard_case_open',
  ],
  [
    'repair_active_case_moderator',
    { targetUserId: '123', caseId: 'case' },
    'intent',
    'moderator_repair',
  ],
  [
    'repair_active_case_administrator',
    { targetUserId: '123', caseId: 'case' },
    'intent',
    'administrator_repair',
  ],
  [
    'close_resolved_case_threads_guild_audit',
    { execute: false, days: 7, limit: 25, userId: null },
    'intent',
    'guild_audit',
  ],
  [
    'close_resolved_case_threads_administrator',
    { execute: true, days: 7, limit: 25, userId: null },
    'intent',
    'administrator_operation',
  ],
  ['complete_setup_verification_provision', { adminChannelId: '123' }, 'mode', 'provision'],
  [
    'complete_setup_verification_verification_modal',
    { adminChannelId: '123' },
    'mode',
    'verification_modal',
  ],
] as const)(
  'constructs the fixed semantic variant for %s',
  (workflowId, input, field, expected) => {
    const workflow = workflowDefinitions.find((entry) => entry.id === workflowId);
    expect(workflow?.parseCommand(input)).toHaveProperty(field, expected);
    expect(workflow?.inputSchema.safeParse({ ...input, [field]: expected }).success).toBe(false);
  }
);

it('preserves observed/report ban subjects and all report closure choices', () => {
  const base = { targetUserId: '123', detectionEventId: 'detection', reason: null };
  expect(
    workflowDefinitions
      .find((entry) => entry.id === 'ban_observed_detection_observed')
      ?.parseCommand(base)
  ).toMatchObject({ subject: { kind: 'observed' } });
  expect(
    workflowDefinitions
      .find((entry) => entry.id === 'ban_observed_detection_report')
      ?.parseCommand({ ...base, reportId: 'report' })
  ).toMatchObject({ subject: { kind: 'report', reportId: 'report' } });
  for (const action of ['mark_actioned', 'dismiss_no_action', 'mark_false_positive'])
    expect(
      humanCommandSchema.safeParse({ kind: 'close_submitted_report', reportId: 'report', action })
        .success
    ).toBe(true);
});

it('resolves opaque references into canonical prompt, cleanup and panel bindings', () => {
  const reject = workflowDefinitions.find((entry) => entry.id === 'reject_intake_candidates');
  const input = { intakeId: 'intake', intakePromptReference: 'opaque-prompt' };
  expect(() => reject?.parseCommand(input)).toThrow();
  expect(
    reject?.parseCommand(input, {
      intakePrompt: { threadId: 'thread', promptMessageId: 'prompt', promptToken: 'secret' },
    })
  ).toEqual({
    kind: 'reject_intake_candidates',
    intakeId: 'intake',
    threadId: 'thread',
    promptMessageId: 'prompt',
    promptToken: 'secret',
  });
  const cleanup = workflowDefinitions.find((entry) => entry.id === 'preview_case_message_deletion');
  expect(
    cleanup?.parseCommand(
      {
        caseId: 'case',
        targetUserId: '123',
        mode: 'delete_only',
        scope: 'source_message',
        reason: '',
        detectionEventId: null,
        cleanupReference: 'opaque-cleanup',
      },
      { cleanup: { jobId: 'job', generation: null } }
    )
  ).toMatchObject({ jobId: 'job', previewReference: { jobId: 'job', generation: null } });
  const panel = workflowDefinitions.find(
    (entry) => entry.id === 'upsert_report_instructions_repost'
  );
  expect(
    panel?.parseCommand(
      { channelId: '123' },
      { panel: { expectedMessageId: null, expectedChannelId: null, submissionId: 'submission' } }
    )
  ).toEqual({
    kind: 'upsert_report_instructions',
    channelId: '123',
    repost: true,
    expectedMessageId: null,
    expectedChannelId: null,
    submissionId: 'submission',
  });
});

it('covers individual and batch attention methods under the named wrapper', () => {
  const attention = workflowDefinitions.find((entry) => entry.id === 'acknowledge_attention');
  expect(attention?.toolName).toBe('drasil_acknowledge_attention');
  expect(attention?.publicMethods).toEqual(['attention.acknowledge', 'attention.acknowledgeBatch']);
  for (const itemIds of [['one'], ['one', 'two']])
    expect(attention?.parseCommand({ itemIds })).toEqual({
      kind: 'acknowledge_attention',
      itemIds,
    });
});

it('requires settings diffs for configuration and retains shared setup workflow policy', () => {
  for (const kind of [
    'update_settings',
    'update_setup',
    'update_heuristics',
    'reset_heuristics',
    'lockdown_allow_add',
    'lockdown_allow_remove',
    'disable_lockdown',
  ])
    expect(workflowDefinitions.find((entry) => entry.commandKind === kind)?.confirmationRule).toBe(
      'exact_settings_diff'
    );
  expect(
    workflowDefinitions.find((entry) => entry.id === 'complete_setup_verification_provision')
      ?.confirmationRule
  ).toBe('shared_policy');
  expect(
    workflowDefinitions.find((entry) => entry.id === 'upsert_report_instructions_repair')
      ?.confirmationRule
  ).toBe('shared_policy');
});
