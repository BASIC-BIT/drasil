import {
  createReportReviewActions,
  type ActionContext,
  type AuthorityFacts,
  type ReportReviewRepository,
  type ReportOpenCaseCandidate,
  type ReportCaseOpenResult,
} from '../index';

const context: ActionContext = {
  guildId: 'guild-1',
  requestId: 'request-1',
  source: 'web',
  actor: { kind: 'user', userId: 'moderator-1' },
};
const staff: AuthorityFacts = {
  guildId: 'guild-1',
  userId: 'moderator-1',
  present: true,
  owner: false,
  permissions: '32',
  roleIds: [],
};
class ReviewFixture {
  public constructor(private readonly facts: AuthorityFacts | null = staff) {}

  public readonly repository = {
    closeSubmittedReport: jest.fn<
      ReturnType<ReportReviewRepository['closeSubmittedReport']>,
      Parameters<ReportReviewRepository['closeSubmittedReport']>
    >(async () => ({
      id: 'report-1',
      server_id: 'guild-1',
      thread_id: 'thread-1',
      status: 'actioned',
      busy: false,
    })),
  };
  public readonly openCaseRepository = {
    findSubmittedReportCaseCandidate: jest.fn(
      async (): Promise<ReportOpenCaseCandidate | null> => ({
        id: 'report-1',
        server_id: 'guild-1',
        status: 'submitted',
        confirmed_target_user_id: 'user-1',
        latest_detection_id: 'det-1',
        latest_case_id: null,
        busy: false,
      })
    ),
  };
  public readonly reportCaseOpener = {
    openObservedDetectionCase: jest.fn(async (): Promise<ReportCaseOpenResult> => ({
      status: 'queued' as const,
      requestId: 'request-1',
    })),
  };
  public readonly queueRepository = {
    deleteReportThreadAttention: jest.fn(async () => [
      {
        id: 'queue-1',
        server_id: 'guild-1',
        item_type: 'report_thread_attention',
        queue_channel_id: 'channel-1',
        queue_message_id: 'message-1',
      },
    ]),
  };
  public readonly queueMessageDeleter = { deleteQueueMessage: jest.fn(async () => undefined) };
  public readonly authority = { loadFresh: jest.fn(async () => this.facts) };
  public readonly staffRoles = { loadRoleIds: jest.fn(async () => ['responder-1']) };
  public readonly dependencies = {
    repository: this.repository,
    openCaseRepository: this.openCaseRepository,
    reportCaseOpener: this.reportCaseOpener,
    queueRepository: this.queueRepository,
    queueMessageDeleter: this.queueMessageDeleter,
    authority: this.authority,
    staffRoles: this.staffRoles,
  };
  public readonly actions = createReportReviewActions(this.dependencies);
}
function arrange(facts: AuthorityFacts | null = staff): ReviewFixture {
  return new ReviewFixture(facts);
}

it('denies_review_without_staff_authority', async () => {
  const f = arrange({ ...staff, permissions: '0' });
  const denied = await f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' });
  expect(denied.kind).toBe('denied');
  expect(await f.actions.openCase(context, { reportId: 'report-1' })).toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.repository.closeSubmittedReport).not.toHaveBeenCalled();
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
});
it('claimed_report_remains_busy', async () => {
  const f = arrange();
  f.repository.closeSubmittedReport.mockResolvedValue({
    id: 'report-1',
    server_id: 'guild-1',
    thread_id: 'thread-1',
    status: 'submitted',
    busy: true,
  });
  const claimed = await f.actions.close(context, {
    reportId: 'report-1',
    action: 'dismiss_no_action',
  });
  if (claimed.kind !== 'outcome') throw new Error(claimed.code);
  expect(claimed.outcome.status).toBe('busy');
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockResolvedValue({
    id: 'report-1',
    server_id: 'guild-1',
    status: 'submitted',
    confirmed_target_user_id: 'user-1',
    latest_detection_id: 'det-1',
    latest_case_id: null,
    busy: true,
  });
  expect(await f.actions.openCase(context, { reportId: 'report-1' })).toMatchObject({
    kind: 'outcome',
    outcome: { status: 'busy' },
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
});
it('closure_keeps_actor_and_source', async () => {
  const f = arrange();
  const result = await f.actions.close(context, {
    reportId: 'report-1',
    action: 'mark_false_positive',
  });
  const savedMetadata = f.repository.closeSubmittedReport.mock.calls[0]?.[0]?.metadata;
  expect(savedMetadata).toMatchObject({ closed_by: 'moderator-1', closed_surface: 'web' });
  if (result.kind !== 'outcome') throw new Error(result.code);
  expect(result.outcome).toMatchObject({
    status: 'closed',
    reportStatus: 'false_positive',
    queueCleanupStatus: 'cleared',
  });
});
it('open_case_retains_queued_receipt', async () => {
  const f = arrange();
  const opened = await f.actions.openCase(context, { reportId: 'report-1' });
  if (opened.kind !== 'outcome') throw new Error(opened.code);
  expect(opened.outcome).toMatchObject({ status: 'queued', requestId: 'request-1' });
  expect(f.queueRepository.deleteReportThreadAttention).not.toHaveBeenCalled();
});

it.each([
  [null, 'actor_unavailable'],
  [{ ...staff, present: false }, 'actor_unavailable'],
  [{ ...staff, guildId: 'other-guild' }, 'binding_mismatch'],
  [{ ...staff, userId: 'other-user' }, 'binding_mismatch'],
])('rejects unavailable or mismatched fresh authority %j', async (facts, code) => {
  const f = arrange(facts);
  await expect(
    f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toEqual({ kind: 'denied', code });
  expect(f.repository.closeSubmittedReport).not.toHaveBeenCalled();
});
it('does not accept a recovery system actor for submitted-report review', async () => {
  const f = arrange();
  const system = {
    ...context,
    actor: { kind: 'system' as const, purpose: 'report_ban_recovery' as const },
  };
  await expect(f.actions.openCase(system, { reportId: 'report-1' })).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.authority.loadFresh).not.toHaveBeenCalled();
});
it.each([
  { ...staff, permissions: '0', owner: true },
  { ...staff, permissions: '8' },
  { ...staff, permissions: String(1n << 40n) },
  { ...staff, permissions: '0', roleIds: ['responder-1'] },
])('accepts each existing report staff authority %j', async (facts) => {
  const f = arrange(facts);
  await expect(
    f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toMatchObject({ kind: 'outcome', outcome: { status: 'closed' } });
});
it('rechecks permissions and responder roles after an earlier successful review', async () => {
  const f = arrange({ ...staff, permissions: '0', roleIds: ['responder-1'] });
  await f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' });
  f.staffRoles.loadRoleIds.mockResolvedValue([]);
  await expect(
    f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.authority.loadFresh).toHaveBeenCalledTimes(2);
});
it('preserves authenticated Discord context provenance without queueing a direct closure', async () => {
  const f = arrange();
  await f.actions.close(
    { ...context, source: 'discord_interaction', requestId: 'interaction-1' },
    { reportId: 'report-1', action: 'mark_actioned' }
  );
  expect(f.repository.closeSubmittedReport.mock.calls[0]?.[0].metadata).toMatchObject({
    closed_by: 'moderator-1',
    closed_surface: 'discord_interaction',
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
});
it('treats missing or closed reports as already handled without cleanup', async () => {
  const f = arrange();
  f.repository.closeSubmittedReport.mockResolvedValue(null);
  await expect(
    f.actions.close(context, { reportId: 'report-1', action: 'dismiss_no_action' })
  ).resolves.toMatchObject({
    outcome: { status: 'already_handled', queueCleanupStatus: 'skipped' },
  });
  expect(f.queueRepository.deleteReportThreadAttention).not.toHaveBeenCalled();
});
it('keeps completed closure successful if queue cleanup fails', async () => {
  const f = arrange();
  const cleanupError = new Error('Discord unavailable');
  f.queueMessageDeleter.deleteQueueMessage.mockRejectedValue(cleanupError);
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    await expect(
      f.actions.close(context, { reportId: 'report-%s-%j', action: 'mark_false_positive' })
    ).resolves.toMatchObject({
      outcome: { status: 'closed', reportStatus: 'false_positive', queueCleanupStatus: 'failed' },
    });
    expect(warn).toHaveBeenCalledWith(
      '[ReportReview] Failed to clear report-thread attention for intake %s:',
      'report-%s-%j',
      cleanupError
    );
  } finally {
    warn.mockRestore();
  }
});
it('skips absent or empty cleanup dependencies', async () => {
  const f = arrange();
  const withoutCleanup = createReportReviewActions({
    ...f.dependencies,
    queueRepository: null,
    queueMessageDeleter: null,
  });
  await expect(
    withoutCleanup.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toMatchObject({ outcome: { queueCleanupStatus: 'skipped' } });
  f.queueRepository.deleteReportThreadAttention.mockResolvedValue([]);
  await expect(
    f.actions.close(context, { reportId: 'report-1', action: 'mark_actioned' })
  ).resolves.toMatchObject({ outcome: { queueCleanupStatus: 'skipped' } });
});
it('retains opener-unavailable when that runtime has no case opener', async () => {
  const f = arrange();
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockResolvedValue(null);
  const unavailable = createReportReviewActions({ ...f.dependencies, reportCaseOpener: null });
  await expect(unavailable.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    outcome: { status: 'opener_unavailable' },
  });
  expect(f.openCaseRepository.findSubmittedReportCaseCandidate).not.toHaveBeenCalled();
});
it.each([
  [null, 'already_handled'],
  [
    {
      id: 'report-1',
      server_id: 'guild-1',
      status: 'submitted',
      confirmed_target_user_id: null,
      latest_detection_id: 'det-1',
      latest_case_id: null,
    },
    'missing_target',
  ],
  [
    {
      id: 'report-1',
      server_id: 'guild-1',
      status: 'submitted',
      confirmed_target_user_id: 'user-1',
      latest_detection_id: null,
      latest_case_id: null,
    },
    'missing_detection',
  ],
  [
    {
      id: 'report-1',
      server_id: 'guild-1',
      status: 'submitted',
      confirmed_target_user_id: 'user-1',
      latest_detection_id: 'det-1',
      latest_case_id: 'case-1',
    },
    'case_exists',
  ],
])('preserves case eligibility and duplicate outcomes %j', async (candidate, status) => {
  const f = arrange();
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockResolvedValue(candidate);
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    outcome: { status },
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
});
it('passes bound target, detection, report and trusted context to the case opener', async () => {
  const f = arrange();
  f.reportCaseOpener.openObservedDetectionCase.mockResolvedValue({
    status: 'opened',
    caseId: 'case-1',
  });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    outcome: { status: 'opened', caseId: 'case-1', queueCleanupStatus: 'cleared' },
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).toHaveBeenCalledWith(context, {
    detectionEventId: 'det-1',
    reportId: 'report-1',
    userId: 'user-1',
  });
});
it.each(['already_handled', 'opener_unavailable'] as const)(
  'retains case opener %s without queue cleanup',
  async (status) => {
    const f = arrange();
    f.reportCaseOpener.openObservedDetectionCase.mockResolvedValue({ status });
    await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
      outcome: { status, queueCleanupStatus: 'skipped' },
    });
  }
);
it('rejects injected identity and invalid review commands before effects', async () => {
  const f = arrange();
  const injected = {
    reportId: 'report-1',
    action: 'mark_actioned' as const,
    actor: { id: 'forged-user' },
  };
  await expect(f.actions.close(context, injected)).rejects.toThrow();
  await expect(f.actions.openCase(context, { reportId: '' })).rejects.toThrow();
  expect(f.repository.closeSubmittedReport).not.toHaveBeenCalled();
});
it.each([
  { id: 'wrong-report', server_id: 'guild-1' },
  { id: 'report-1', server_id: 'wrong-guild' },
])('rejects mismatched candidate %j', async (binding) => {
  const f = arrange();
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockResolvedValue({
    ...binding,
    status: 'submitted',
    confirmed_target_user_id: 'user-1',
    latest_detection_id: 'det-1',
    latest_case_id: null,
  });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toEqual({
    kind: 'denied',
    code: 'binding_mismatch',
  });
});
it('does not enqueue a report whose submitted state changed', async () => {
  const f = arrange();
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockResolvedValue({
    id: 'report-1',
    server_id: 'guild-1',
    status: 'actioned',
    confirmed_target_user_id: 'user-1',
    latest_detection_id: 'det-1',
    latest_case_id: null,
  });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    outcome: { status: 'already_handled' },
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
});

it('denies case opening for a configured responder with no moderation permissions', async () => {
  const f = arrange({ ...staff, permissions: '0', roleIds: ['responder-1'] });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.openCaseRepository.findSubmittedReportCaseCandidate).not.toHaveBeenCalled();
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
  expect(f.staffRoles.loadRoleIds).not.toHaveBeenCalled();
});
it('denies case opening after moderation permission revocation while the responder role remains', async () => {
  const f = arrange({ ...staff, roleIds: ['responder-1'] });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { status: 'queued' },
  });
  f.openCaseRepository.findSubmittedReportCaseCandidate.mockClear();
  f.reportCaseOpener.openObservedDetectionCase.mockClear();
  f.authority.loadFresh.mockResolvedValue({ ...staff, permissions: '0', roleIds: ['responder-1'] });
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toEqual({
    kind: 'denied',
    code: 'permission_denied',
  });
  expect(f.authority.loadFresh).toHaveBeenCalledTimes(2);
  expect(f.openCaseRepository.findSubmittedReportCaseCandidate).not.toHaveBeenCalled();
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
  expect(f.staffRoles.loadRoleIds).not.toHaveBeenCalled();
});
it.each([
  { ...staff, permissions: '0', owner: true },
  { ...staff, permissions: '8' },
  { ...staff, permissions: '32' },
  { ...staff, permissions: String(1n << 40n) },
])('accepts the existing case-opening moderation authority %j', async (facts) => {
  const f = arrange(facts);
  await expect(f.actions.openCase(context, { reportId: 'report-1' })).resolves.toMatchObject({
    kind: 'outcome',
    outcome: { status: 'queued' },
  });
});

it('prepares a bound child without opening a case or clearing attention', async () => {
  const f = arrange();
  const prepared = await f.actions.prepareSubmittedReportCaseOpen(context, {
    reportId: 'report-1',
  });
  expect(prepared).toMatchObject({
    kind: 'ready',
    command: {
      kind: 'open_case_from_observed_detection',
      reportId: 'report-1',
      targetUserId: 'user-1',
      detectionEventId: 'det-1',
    },
    precondition: { kind: 'report_case_candidate', candidate: { id: 'report-1' } },
  });
  expect(f.reportCaseOpener.openObservedDetectionCase).not.toHaveBeenCalled();
  expect(f.queueRepository.deleteReportThreadAttention).not.toHaveBeenCalled();
});
