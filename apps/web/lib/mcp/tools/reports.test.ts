import { it, expect, vi } from 'vitest';
import { createReportTools, createReportIntentResolver } from './reports';
import {
  workflowDefinitions,
  createIntentService,
  projectIntent,
  type WorkflowId,
  type IntentStore,
  type ReportResolutionResources,
} from '@drasil/application';
import { accessFixture, principal, guildId } from '../queryTestFixtures';
it('registers every report, detection and review workflow without accepting private prompt fields', async () => {
  const submit = vi.fn(async () => ({ state: 'queued' as const }));
  const tools = createReportTools({ service: { submit } });
  expect(tools.map((t) => t.id)).toEqual(
    workflowDefinitions
      .filter((w) => ['reports', 'detections', 'reportReview'].includes(w.family))
      .map((w) => w.id)
  );
  const tool = tools.find((t) => t.id === 'reject_intake_candidates')!;
  await expect(
    tool.handler(principal, {
      guildId,
      idempotencyKey: 'key',
      intakeId: 'intake',
      intakePromptReference: 'opaque',
      promptToken: 'secret',
    })
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});

it('projects exact saved report confirmations with public fields and frozen child facts only', async () => {
  const h = accessFixture();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  const actor = { ...principal, scopes: h.grant.scopes };
  const resources: ReportResolutionResources = {
    prepareSubmittedReportCaseOpen: async (reportId) => ({
      kind: 'ready',
      command: {
        kind: 'open_case_from_observed_detection',
        reportId,
        targetUserId: `target-${reportId}`,
        detectionEventId: `detection-${reportId}`,
      },
      precondition: {
        kind: 'report_case_candidate',
        candidate: {
          id: reportId,
          server_id: guildId,
          status: 'submitted',
          confirmed_target_user_id: `target-${reportId}`,
          latest_detection_id: `detection-${reportId}`,
          latest_case_id: null,
        },
      },
      base: {
        actor: { id: actor.userId, surface: 'mcp' },
        action: 'open_case',
        reportId,
        caseId: null,
        detectionEventId: null,
        targetUserId: null,
        status: 'opener_unavailable',
        queueCleanupStatus: 'skipped',
      },
    }),
    resolveIntakeChoice: async () => ({
      intakeId: 'intake',
      guildId,
      threadId: 'PRIVATE-THREAD',
      promptMessageId: 'PRIVATE-PROMPT',
      promptToken: 'PRIVATE-TOKEN',
      candidateIds: ['target', 'other'],
      precondition: {
        kind: 'intake_prompt',
        intakeId: 'intake',
        guildId,
        fingerprint: 'private-digest',
      },
    }),
    loadReview: async (reviewReference) => ({
      operationId: 'operation',
      targetUserId: 'target',
      reviewReference,
      expiresAt: new Date(Date.now() + 600000),
    }),
    message: async (input) => ({
      kind: 'report_message',
      guildId,
      ...input,
      fingerprint: 'private-digest',
    }),
    detection: async () => ({ guildId, targetUserId: 'target', reportId: 'report' }),
  };
  const resolver = createReportIntentResolver({ access: h.access, resources: () => resources });
  const saveIntent = vi.fn<IntentStore['saveIntent']>(async (_principal, intent) => intent);
  const store: IntentStore = {
    saveIntent,
    findIntentByKey: async () => null,
    loadIntent: async () => null,
    denyIntent: async () => null,
    cancelIntent: async () => null,
    acceptIntent: async () => {
      throw new Error('unused');
    },
  };
  const service = createIntentService({ store, access: h.access, resolver });
  const scenarios: [WorkflowId, Record<string, unknown>, string][] = [
    [
      'submit_user_report',
      { targetUserId: 'target', targetLabel: 'name', reason: 'spam' },
      'Submit user report: target "target"; label "name"; reason "spam".',
    ],
    [
      'submit_user_report',
      { targetUserId: 'other', targetLabel: '<@123>', reason: 'different\nreason' },
      'Submit user report: target "other"; label "<@123>"; reason "different\\nreason".',
    ],
    [
      'submit_user_report',
      { targetUserId: 'target', targetLabel: 'name', reason: null },
      'Submit user report: target "target"; label "name"; reason null.',
    ],
    [
      'submit_message_report',
      { targetUserId: 'target', channelId: 'channel', messageId: 'message', reason: 'spam' },
      'Submit message report: target "target"; channel "channel"; message "message"; reason "spam".',
    ],
    ['start_report_intake', { channelId: 'channel' }, 'Start report intake: channel "channel".'],
    ['close_report_intake', { intakeId: 'intake' }, 'Close report intake: intake "intake".'],
    [
      'confirm_intake_candidate',
      { intakeId: 'intake', targetUserId: 'target', intakePromptReference: 'PRIVATE-REFERENCE' },
      'Confirm intake candidate: intake "intake"; target "target".',
    ],
    [
      'reject_intake_candidates',
      { intakeId: 'intake', intakePromptReference: 'PRIVATE-REFERENCE' },
      'Reject intake candidates: intake "intake"; candidates ["target","other"].',
    ],
    [
      'dismiss_observed_detection',
      { targetUserId: 'target', detectionEventId: 'detection' },
      'Dismiss observed detection: detection "detection"; target "target".',
    ],
    [
      'mark_observed_detection_false_positive',
      { targetUserId: 'target', detectionEventId: 'detection' },
      'Mark observed detection false positive: detection "detection"; target "target".',
    ],
    [
      'undo_observed_detection_action',
      { targetUserId: 'target', detectionEventId: 'detection' },
      'Undo observed detection action: detection "detection"; target "target".',
    ],
    [
      'kick_observed_detection',
      { targetUserId: 'target', detectionEventId: 'detection', reason: null },
      'Kick observed detection target: detection "detection"; target "target"; reason null.',
    ],
    [
      'ban_observed_detection_observed',
      { targetUserId: 'target', detectionEventId: 'detection', reason: 'spam' },
      'Ban observed detection target: detection "detection"; target "target"; subject observed detection; reason "spam".',
    ],
    [
      'ban_observed_detection_report',
      { targetUserId: 'target', detectionEventId: 'detection', reportId: 'report', reason: 'spam' },
      'Ban observed detection target: detection "detection"; target "target"; report "report"; reason "spam".',
    ],
    [
      'ignore_detection_accounting',
      { targetUserId: 'target', detectionEventId: 'detection', reason: 'spam' },
      'Ignore detection accounting: detection "detection"; target "target"; reason "spam".',
    ],
    [
      'restore_detection_accounting',
      { targetUserId: 'target', detectionEventId: 'detection', reason: 'spam' },
      'Restore detection accounting: detection "detection"; target "target"; reason "spam".',
    ],
    [
      'prepare_report_ban_review',
      { operationId: 'operation' },
      'Prepare report ban review: operation "operation".',
    ],
    [
      'review_uncertain_report_ban',
      {
        operationId: 'operation',
        targetUserId: 'target',
        reviewReference: 'PRIVATE-REFERENCE',
        reason: 'no current ban',
      },
      'Review uncertain report ban: operation "operation"; target "target"; reason "no current ban".',
    ],
    ...(['mark_actioned', 'dismiss_no_action', 'mark_false_positive'] as const).map(
      (action): [WorkflowId, Record<string, unknown>, string] => [
        'close_submitted_report',
        { reportId: 'report', action },
        `Close submitted report: report "report"; action "${action}".`,
      ]
    ),
    ...['report', 'other'].map((reportId): [WorkflowId, Record<string, unknown>, string] => [
      'open_submitted_report_case',
      { reportId },
      `Open submitted report case: report "${reportId}"; target "target-${reportId}"; detection "detection-${reportId}".`,
    ]),
  ];
  for (const [index, [workflowId, input, summary]] of scenarios.entries()) {
    const intent = await service.prepareIntent(actor, {
      workflowId,
      guildId,
      input,
      idempotencyKey: `summary-${index}`,
    });
    expect(saveIntent).toHaveBeenLastCalledWith(actor, expect.objectContaining({ summary }));
    const confirmation = projectIntent(intent);
    expect(confirmation).toMatchObject({ state: 'confirmation_required', summary });
    expect(JSON.stringify(confirmation)).not.toMatch(
      /PRIVATE-|private-digest|promptToken|attemptToken/
    );
  }
});
it('freezes the report child and retains typed legitimate no-op outcomes', async () => {
  const h = accessFixture();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  const actor = { ...principal, scopes: h.grant.scopes };
  const resources: ReportResolutionResources = {
    prepareSubmittedReportCaseOpen: vi.fn(async () => ({
      kind: 'outcome' as const,
      outcome: {
        actor: { id: actor.userId, surface: 'mcp' },
        action: 'open_case' as const,
        reportId: 'report',
        status: 'busy' as const,
        caseId: null,
        detectionEventId: null,
        targetUserId: null,
        queueCleanupStatus: 'skipped' as const,
      },
    })),
    resolveIntakeChoice: async () => {
      throw new Error('unused');
    },
    loadReview: async () => null,
    message: async () => null,
    detection: async () => null,
  };
  const resolver = createReportIntentResolver({ access: h.access, resources: () => resources });
  const input = {
    guildId,
    workflowId: 'open_submitted_report_case' as const,
    idempotencyKey: 'key',
    input: { reportId: 'report' },
  };
  expect(await resolver.resolve(actor, input)).toMatchObject({
    delivery: { kind: 'report_case_terminal', outcome: { status: 'busy' } },
  });
});
