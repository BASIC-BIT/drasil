import { projectReportIntakeState, type ReportIntakeSnapshot } from './intakeState';
const analysis = {
  schemaVersion: 1,
  sources: {},
  requestReservations: [],
  coverage: null,
  outcome: {
    kind: 'admin_review',
    reason: 'no_match',
    candidates: [],
    coverage: { kind: 'unavailable', reason: 'transport' },
    includedEvidenceIds: [],
    excludedEvidenceIds: [],
  },
  handoff: {
    state: 'delivered',
    reason: 'no_match',
    attempts: 1,
    nextDueAt: null,
    receipt: 'sent',
    messageId: 'review',
    channelId: 'admin',
  },
  presentation: { revision: 2, attempts: 1, nextDueAt: null, lease: null },
};
function snapshot(metadata: unknown): ReportIntakeSnapshot {
  return {
    id: 'intake',
    server_id: 'guild',
    reporter_id: 'reporter',
    thread_id: 'thread',
    status: 'needs_admin_confirmation',
    confirmed_target_user_id: null,
    evidence_revision: 2,
    metadata,
  };
}
it('uses only a persisted delivery binding for staff artifact authority', () => {
  expect(projectReportIntakeState(snapshot({ analysis }))).toMatchObject({
    promptMessageId: null,
    presentationRevision: null,
    staged: true,
  });
  expect(
    projectReportIntakeState(
      snapshot({
        analysis,
        admin_review_prompt_revision: 2,
        admin_review_prompt_message_id: 'review',
      })
    )
  ).toMatchObject({ promptMessageId: 'review', presentationRevision: 2, staged: true });
  expect(
    projectReportIntakeState(
      snapshot({
        analysis,
        admin_review_prompt_revision: 2,
        admin_review_prompt_message_id: 'forged',
      })
    )
  ).toMatchObject({ promptMessageId: null, presentationRevision: null });
});
it('does not turn raw quarantined analysis into prompt authority', () => {
  expect(
    projectReportIntakeState(
      snapshot({
        admin_review_prompt_revision: 2,
        admin_review_prompt_message_id: 'review',
        analysis: { ...analysis, sources: 'broken' },
      })
    )
  ).toMatchObject({ promptMessageId: null, presentationRevision: null, candidateIds: [] });
});
it('retains shipped legacy prompt state while distinguishing staged prompts at revision zero', () => {
  const legacy = {
    ...snapshot({
      last_confirmation_prompt_message_id: 'prompt',
      last_confirmation_prompt_token: 'token',
      last_confirmation_prompt_candidate_ids: ['target'],
    }),
    status: 'needs_reporter_confirmation',
    evidence_revision: 0,
  };
  expect(projectReportIntakeState(legacy)).toMatchObject({
    staged: false,
    evidenceRevision: 0,
    presentationRevision: null,
    promptMessageId: 'prompt',
  });
  expect(
    projectReportIntakeState({
      ...legacy,
      metadata: { ...(legacy.metadata as object), analysis, last_confirmation_prompt_revision: 0 },
    })
  ).toMatchObject({ staged: true, presentationRevision: 0 });
});

it('retains workflow ownership at revision zero and rejects unbound or unsettled recovery facts', () => {
  const base = { ...snapshot({ workflow: 'staged' }), evidence_revision: 0 };
  expect(projectReportIntakeState(base).staged).toBe(true);
  const submission = {
    token: 'attempt',
    targetUserId: 'target',
    state: 'unknown',
    claimedAt: '2026-11-03T00:00:00.000Z',
    dispatchedAt: '2026-11-03T00:00:01.000Z',
    settledAt: '2026-11-03T00:00:02.000Z',
  };
  expect(projectReportIntakeState({ ...base, metadata: { submission } }).submission).toBeNull();
  expect(
    projectReportIntakeState({
      ...base,
      confirmed_target_user_id: 'target',
      metadata: { submission },
    }).submission?.state
  ).toBe('unknown');
  expect(
    projectReportIntakeState({
      ...base,
      confirmed_target_user_id: 'target',
      metadata: { submission: { ...submission, settledAt: undefined } },
    }).submission
  ).toBeNull();
});
