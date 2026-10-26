import { beforeEach, expect, it, vi } from 'vitest';
import { fixtureCaseDetails } from './caseFixtures';
import { fixtureReportDetail } from './reportFixtures';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from './messageCleanupFixtures';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { workspaceItemDetailSchema } from './moderationWorkspaceTypes';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
const state = vi.hoisted(() => ({
  query: vi.fn(),
  detail: vi.fn(),
  report: vi.fn(),
  member: vi.fn(),
  requests: vi.fn(),
  request: vi.fn(),
  cleanup: vi.fn(),
  job: vi.fn(),
}));
vi.mock('./setupDataAdapter', () => ({ getPostgresPool: () => ({ query: state.query }) }));
vi.mock('./activeCaseDataAdapter', async (original) => ({
  ...(await original<typeof import('./activeCaseDataAdapter')>()),
  createActiveCaseDataAdapter: () => ({
    getCaseDetail: state.detail,
    canQueueCaseActions: () => true,
  }),
}));
vi.mock('./reportDetailDataAdapter', () => ({
  createReportDetailDataAdapter: () => ({ getReportDetail: state.report }),
}));
vi.mock('./memberProfileDataAdapter', async (original) => ({
  ...(await original<typeof import('./memberProfileDataAdapter')>()),
  createMemberProfileDataAdapter: () => ({ getMemberProfile: state.member }),
}));
vi.mock('./moderationActionRequestDataAdapter', async (original) => ({
  ...(await original<typeof import('./moderationActionRequestDataAdapter')>()),
  createModerationActionRequestDataAdapter: () => ({
    listCaseRequests: state.requests,
    listInboxRequests: state.requests,
    getRequest: state.request,
  }),
}));
vi.mock('./messageCleanupDataAdapter', () => ({
  createMessageCleanupDataAdapter: () => ({
    getCaseWorkspace: state.cleanup,
    getJobDetail: state.job,
  }),
}));
vi.mock('./reportQueueDataAdapter', () => ({
  createReportQueueDataAdapter: () => ({ canOpenSubmittedReportCase: () => true }),
}));
const actor = {
  guildId: 'guild-1',
  userId: 'admin',
  present: true,
  owner: true,
  permissions: '8',
  roleIds: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.query.mockResolvedValue({ rows: [] });
  state.detail.mockResolvedValue(null);
  state.report.mockResolvedValue(null);
  state.member.mockResolvedValue(null);
  state.requests.mockResolvedValue([]);
  state.cleanup.mockResolvedValue(null);
});
it('reads a resolved case directly after it leaves the queue and validates the composed model', async () => {
  state.detail.mockResolvedValue({ ...fixtureCaseDetails[0], status: 'verified' });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'case:case-stale',
  });
  expect(result).toMatchObject({
    kind: 'case',
    data: { detail: { status: 'verified' }, membership: null, requests: [], cleanup: null },
  });
  expect(workspaceItemDetailSchema.safeParse(result).success).toBe(true);
});
it('keeps an unknown submitted report target unknown', async () => {
  state.report.mockResolvedValue({ ...fixtureReportDetail('report-1'), targetUserId: null });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'report:report-1',
  });
  expect(result).toMatchObject({
    kind: 'submitted_report',
    report: { targetUserId: null },
    item: { subject: { userId: null, displayLabel: 'Unknown report target' } },
  });
});
it('reads a detection by guild and ID with complete reasons and original event time', async () => {
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from detection_events de')
      ? [
          {
            id: 'det-1',
            server_id: 'guild-1',
            user_id: 'user-1',
            detection_type: 'suspicious_content',
            confidence: 0.8,
            detected_at: '2026-10-21T14:40:00.000Z',
            reasons: ['one', 'two', 'three'],
            metadata: {},
            latest_verification_event_id: null,
            admin_action: null,
            admin_action_at: null,
            admin_action_by: null,
            channel_id: 'channel',
            message_id: 'message',
            latest_accounting_action_type: null,
            latest_accounting_action_at: null,
          },
        ]
      : [],
  }));
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'detection:det-1',
  });
  expect(result).toMatchObject({
    kind: 'observed_alert',
    detection: { reasons: ['one', 'two', 'three'], detectedAt: '2026-10-21T14:40:00.000Z' },
  });
  expect(
    state.query.mock.calls.find(([sql]) => sql.includes('from detection_events de'))?.[1]
  ).toEqual(['guild-1', 'det-1']);
});
it('denies mismatched actor scope and records returned from another guild', async () => {
  expect(
    await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
      guildId: 'guild-2',
      itemId: 'queue:foreign-item',
    })
  ).toBeNull();
  state.detail.mockResolvedValue({ ...fixtureCaseDetails[0], guildId: 'guild-2' });
  expect(
    await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
      guildId: 'guild-1',
      caseId: 'case-stale',
    })
  ).toBeNull();
});
it('filters actions for current permissions and settings', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.query.mockResolvedValue({
    rows: [
      {
        settings: {
          moderator_ban_action_enabled: false,
          moderator_kick_action_requires_reason: true,
        },
      },
    ],
  });
  const result = await createModerationWorkspaceDataAdapter({
    ...actor,
    owner: false,
    permissions: '32',
  }).getInboxItemDetail({ guildId: 'guild-1', itemId: 'case:case-stale' });
  expect(result?.policy.allowedActions).not.toContain('ban_user');
  expect(result?.policy.allowedActions).not.toContain('kick_user');
  expect(result?.policy).toMatchObject({ canManageCleanup: false, kickReasonRequired: true });
});

it('reads tracked requests directly and excludes requests with another target or linkage', async () => {
  state.report.mockResolvedValue(fixtureReportDetail('report-1'));
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_action_requests')
      ? [{ id: 'old' }, { id: 'foreign' }, { id: 'wrong-case' }]
      : [],
  }));
  const request = {
    id: 'old',
    actionType: 'ban_observed_detection',
    actorSurface: 'web',
    completedAt: null,
    detectionEventId: null,
    failedAt: null,
    lastError: null,
    messageDeletionJobId: null,
    requestedAt: '2026-01-01T00:00:00.000Z',
    reportIntakeId: 'report-1',
    requestedAction: null,
    resultSummary: null,
    status: 'queued',
    targetUserId: 'user-300',
    updatedAt: '2026-01-01T00:00:00.000Z',
    verificationEventId: null,
  };
  state.request.mockImplementation(async (_guildId: string, id: string) =>
    id === 'old'
      ? request
      : id === 'foreign'
        ? { ...request, id, targetUserId: 'another-user' }
        : { ...request, id, verificationEventId: 'another-case' }
  );
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'report:report-1',
  });
  expect(result).toMatchObject({ kind: 'submitted_report', requests: [{ id: 'old' }] });
  expect(state.request).toHaveBeenCalledWith('guild-1', 'old');
  expect(state.requests).not.toHaveBeenCalled();
});
it('rejects a case report and membership belonging to another member', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from verification_events ve')
      ? [{ report_id: 'report-1', detection_id: 'det-1' }]
      : [],
  }));
  state.report.mockResolvedValue({
    ...fixtureReportDetail('report-1'),
    latestCaseId: 'case-stale',
  });
  state.member.mockResolvedValue({ guildId: 'guild-1', userId: 'wrong-user', membership: {} });
  const result = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
    guildId: 'guild-1',
    caseId: 'case-stale',
  });
  expect(result).toMatchObject({ report: null, membership: null });
});
it('requires kind-matching nested items and strips unknown raw metadata', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'case:case-stale',
  });
  expect(
    workspaceItemDetailSchema.safeParse({
      ...result,
      item: { ...result?.item, kind: 'observed_alert' },
    }).success
  ).toBe(false);
  expect(workspaceItemDetailSchema.parse({ ...result, metadata: 'private' })).not.toHaveProperty(
    'metadata'
  );
});

it('uses actual reporter and target labels when they are recorded', async () => {
  state.report.mockResolvedValue({
    ...fixtureReportDetail('report-1'),
    targetDisplayName: 'Recorded target',
    reporterDisplayName: 'Recorded reporter',
  });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'report:report-1',
  });
  expect(result?.item.subject).toMatchObject({
    displayLabel: 'Recorded target',
    secondaryLabel: 'Reporter Recorded reporter',
  });
});
it('preserves an unknown detection event time without substituting epoch or queue dates', async () => {
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from detection_events de')
      ? [
          {
            id: 'det-unknown',
            server_id: 'guild-1',
            user_id: 'user-1',
            detection_type: 'suspicious_content',
            confidence: 0.8,
            detected_at: null,
            reasons: [],
            metadata: {},
            latest_verification_event_id: null,
            admin_action: null,
            admin_action_at: null,
            admin_action_by: null,
            channel_id: null,
            message_id: null,
            latest_accounting_action_type: null,
            latest_accounting_action_at: null,
          },
        ]
      : [],
  }));
  expect(
    await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
      guildId: 'guild-1',
      itemId: 'detection:det-unknown',
    })
  ).toMatchObject({
    kind: 'observed_alert',
    detection: { detectedAt: null },
    item: { createdAt: null, updatedAt: null, stale: false },
  });
});
it('keeps a handled detection readable without offering its previous mutations', async () => {
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from detection_events de')
      ? [
          {
            id: 'det-banned',
            server_id: 'guild-1',
            user_id: 'user-1',
            detection_type: 'suspicious_content',
            confidence: 0.8,
            detected_at: '2026-10-21T14:40:00.000Z',
            reasons: ['Original reason'],
            metadata: { observed_action: 'ban' },
            latest_verification_event_id: null,
            admin_action: null,
            admin_action_at: null,
            admin_action_by: null,
            channel_id: null,
            message_id: null,
            latest_accounting_action_type: null,
            latest_accounting_action_at: null,
          },
        ]
      : [],
  }));
  expect(
    await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
      guildId: 'guild-1',
      itemId: 'detection:det-banned',
    })
  ).toMatchObject({
    kind: 'observed_alert',
    item: { statusLabel: 'ban', allowedActions: ['view_history', 'open_discord'] },
  });
});

it('attaches only cleanup jobs matching the selected guild, case and member', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.cleanup.mockResolvedValue(fixtureMessageCleanupCaseWorkspaces[0]);
  state.job.mockResolvedValue({
    ...fixtureMessageCleanupJobDetails[0],
    targetUserId: 'wrong-member',
  });
  expect(
    await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
      guildId: 'guild-1',
      caseId: 'case-stale',
    })
  ).toMatchObject({ cleanup: { jobs: [] } });
  state.job.mockImplementation(
    async (_guild: string, _case: string, id: string) =>
      fixtureMessageCleanupJobDetails.find((job) => job.id === id) ?? null
  );
  const result = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
    guildId: 'guild-1',
    caseId: 'case-stale',
  });
  expect(result?.cleanup?.jobs.length).toBeGreaterThan(0);
  expect(
    result?.cleanup?.jobs.every(
      (job) =>
        job.guildId === 'guild-1' &&
        job.verificationEventId === 'case-stale' &&
        job.targetUserId === 'user-100'
    )
  ).toBe(true);
});
it('rejects a cleanup workspace from another guild before loading its jobs', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.cleanup.mockResolvedValue({
    ...fixtureMessageCleanupCaseWorkspaces[0],
    guildId: 'guild-2',
  });
  expect(
    await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
      guildId: 'guild-1',
      caseId: 'case-stale',
    })
  ).toMatchObject({ cleanup: null });
  expect(state.job).not.toHaveBeenCalled();
});
it('emits all trusted linked-report conversation keys while retaining report identity', async () => {
  const guildId = '100000000000000001';
  const detail = { ...fixtureCaseDetails[0], guildId };
  const report = {
    ...fixtureReportDetail('report-1')!,
    guildId,
    targetUserId: detail.userId,
    latestCaseId: detail.id,
  };
  report.evidence = report.evidence.map((item) => ({
    ...item,
    sourceMessageUrl: `https://discord.com/channels/${guildId}/100000000000000002/100000000000000003`,
  }));
  state.detail.mockResolvedValue(detail);
  state.report.mockResolvedValue(report);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from verification_events ve')
      ? [{ report_id: report.id, detection_id: 'det-1' }]
      : [],
  }));
  const result = await createModerationWorkspaceDataAdapter({
    ...actor,
    guildId,
  }).getCaseWorkspaceData({ guildId, caseId: detail.id });
  expect(result?.conversationSources?.map((source) => source.sourceKey)).toEqual(
    report.evidence.map((item) => `evidence:${item.id}`)
  );
  expect(
    result?.conversationSources?.every(
      (source) => source.recordKind === 'report' && source.recordId === report.id
    )
  ).toBe(true);
});
it('returns the authenticated actor, removes close without action, and retains recovery attention source identity', async () => {
  const detail = {
    ...fixtureCaseDetails[0],
    caseKind: 'compromised_account',
    attentionState: 'parked',
    allowedActions: ['verify_user', 'close_no_action'],
  };
  state.detail.mockResolvedValue(detail);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_queue_items mqi')
      ? [
          {
            id: 'breach-1',
            server_id: 'guild-1',
            user_id: detail.userId,
            item_type: 'quarantine_breach_attention',
            verification_event_id: detail.id,
            detection_event_id: null,
            report_intake_id: null,
            source_thread_id: 'actual-channel',
            queue_channel_id: null,
            queue_message_id: null,
            last_source_message_id: 'actual-message',
            last_notified_at: null,
            created_at: null,
            updated_at: '2026-10-25T12:00:00Z',
            metadata: {},
            server_settings: {},
            case_kind: 'compromised_account',
            case_status: 'pending',
            detection_type: null,
            detection_confidence: null,
            detection_detected_at: null,
            detection_reasons: null,
            detection_metadata: {},
            report_status: null,
            report_summary: null,
            report_metadata: {},
            user_username: 'member',
            user_metadata: {},
          },
        ]
      : [],
  }));
  const result = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
    guildId: 'guild-1',
    caseId: detail.id,
  });
  expect(result?.actorUserId).toBe('admin');
  expect(result?.detail.allowedActions).not.toContain('close_no_action');
  expect(result?.policy.allowedActions).not.toContain('close_no_action');
  expect(result?.recoveryAttention).toMatchObject([
    {
      id: 'queue:breach-1',
      subject: { userId: detail.userId },
      sourceMetadata: {
        caseId: detail.id,
        sourceThreadId: 'actual-channel',
        latestReplyMessageId: 'actual-message',
      },
    },
  ]);
});

it('reads configured issuance method/revision separately from challenge history and preserves unknown configuration', async () => {
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('select settings from servers')
      ? [{ settings: { captcha_method: 'discord_image', captcha_method_revision: 8 } }]
      : [],
  }));
  const data = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
    guildId: 'guild-1',
    caseId: fixtureCaseDetails[0].id,
  });
  expect(data?.securityCheckConfiguration).toEqual({ method: 'discord_image', methodRevision: 8 });
  state.query.mockResolvedValue({ rows: [] });
  const unknown = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
    guildId: 'guild-1',
    caseId: fixtureCaseDetails[0].id,
  });
  expect(unknown?.securityCheckConfiguration).toBeNull();
});

function caseReadRequest(
  status: ModerationActionRequestSummary['status'],
  updatedAt = '2026-10-26T12:00:00.000Z'
): ModerationActionRequestSummary {
  return {
    id: 'case-read-request',
    guildId: 'guild-1',
    actionType: 'verify_case_user',
    actorSurface: 'web',
    completedAt: status === 'completed' ? updatedAt : null,
    detectionEventId: null,
    failedAt: status === 'failed' ? updatedAt : null,
    lastError: null,
    messageDeletionJobId: null,
    requestedAt: '2026-10-26T11:00:00.000Z',
    reportIntakeId: null,
    requestedAction: 'verify_user',
    resultSummary: null,
    status,
    targetUserId: 'user-100',
    updatedAt,
    verificationEventId: 'case-stale',
  };
}
function supplyCaseReadRequest() {
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_action_requests') ? [{ id: 'case-read-request' }] : [],
  }));
}
it.each(['completed', 'failed'] as const)(
  'an initial %s receipt uses the later authoritative case and dependent reads',
  async (status) => {
    supplyCaseReadRequest();
    let current = fixtureCaseDetails[0];
    state.detail.mockImplementation(async () => current);
    state.request.mockImplementation(async () => {
      current = {
        ...current,
        status: status === 'completed' ? 'verified' : 'closed_no_action',
        allowedActions: [],
      };
      return caseReadRequest(status);
    });
    state.member.mockImplementation(async () => ({
      guildId: 'guild-1',
      userId: 'user-100',
      membership: {
        joinDate: null,
        lastMessageAt: null,
        messageCount: null,
        verificationStatus: current.status,
        caseRoleActive: false,
        screeningPending: false,
      },
    }));
    state.cleanup.mockImplementation(async () => ({
      ...fixtureMessageCleanupCaseWorkspaces[0],
      caseStatus: current.status,
      latestJobs: [],
    }));
    const result = await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
      guildId: 'guild-1',
      caseId: 'case-stale',
    });
    expect(result).toMatchObject({
      detail: { status: current.status },
      policy: { allowedActions: ['view_case'] },
      membership: { verificationStatus: current.status },
      cleanup: { workspace: { caseStatus: current.status } },
      requests: [{ id: 'case-read-request', status }],
    });
    expect(state.detail).toHaveBeenCalledTimes(2);
    expect(state.request).toHaveBeenCalledTimes(1);
  }
);
it('keeps a queued capture active when completion follows it, then reads the completed case', async () => {
  supplyCaseReadRequest();
  let current = fixtureCaseDetails[0];
  let request = caseReadRequest('queued');
  state.detail.mockImplementation(async () => current);
  state.request.mockImplementation(async () => request);
  state.member.mockImplementation(async () => {
    current = { ...current, status: 'verified', allowedActions: [] };
    request = caseReadRequest('completed');
    return null;
  });
  const adapter = createModerationWorkspaceDataAdapter(actor);
  const input = { guildId: 'guild-1', caseId: 'case-stale' };
  expect(await adapter.getCaseWorkspaceData(input)).toMatchObject({
    detail: { status: 'pending' },
    requests: [{ status: 'queued' }],
  });
  expect(await adapter.getCaseWorkspaceData(input)).toMatchObject({
    detail: { status: 'verified' },
    policy: { allowedActions: ['view_case'] },
    requests: [{ status: 'completed' }],
  });
  expect(state.request).toHaveBeenCalledTimes(2);
  expect(state.detail).toHaveBeenCalledTimes(3);
});
it('captures each retry version once without retaining terminal state between reads', async () => {
  supplyCaseReadRequest();
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  const adapter = createModerationWorkspaceDataAdapter(actor);
  for (const [index, status] of (
    ['failed', 'queued', 'processing', 'completed', 'completed'] as const
  ).entries()) {
    const updatedAt = `2026-10-26T12:00:0${Math.min(index, 3)}.000Z`;
    state.request.mockResolvedValue(caseReadRequest(status, updatedAt));
    const result = await adapter.getCaseWorkspaceData({ guildId: 'guild-1', caseId: 'case-stale' });
    expect(result?.requests).toEqual([caseReadRequest(status, updatedAt)]);
    expect(result?.detail.status).toBe('pending');
  }
  expect(state.request).toHaveBeenCalledTimes(5);
  expect(state.detail).toHaveBeenCalledTimes(8);
});
it.each([
  ['missing', null],
  ['guild', { ...fixtureCaseDetails[0], guildId: 'guild-2' }],
  ['case', { ...fixtureCaseDetails[0], id: 'another-case' }],
  ['member', { ...fixtureCaseDetails[0], userId: 'another-member' }],
])(
  'rejects %s identity drift after terminal capture before dependent reads',
  async (_label, changed) => {
    supplyCaseReadRequest();
    state.detail.mockResolvedValueOnce(fixtureCaseDetails[0]).mockResolvedValueOnce(changed);
    state.request.mockResolvedValue(caseReadRequest('completed'));
    expect(
      await createModerationWorkspaceDataAdapter(actor).getCaseWorkspaceData({
        guildId: 'guild-1',
        caseId: 'case-stale',
      })
    ).toBeNull();
    expect(state.member).not.toHaveBeenCalled();
    expect(state.cleanup).not.toHaveBeenCalled();
  }
);
it('does not attach another member terminal request or carry it to a foreign scope', async () => {
  supplyCaseReadRequest();
  state.detail.mockResolvedValue(fixtureCaseDetails[0]);
  state.request.mockResolvedValue({
    ...caseReadRequest('completed'),
    targetUserId: 'another-member',
  });
  const adapter = createModerationWorkspaceDataAdapter(actor);
  expect(
    await adapter.getCaseWorkspaceData({ guildId: 'guild-1', caseId: 'case-stale' })
  ).toMatchObject({ detail: { status: 'pending' }, requests: [] });
  expect(
    await adapter.getCaseWorkspaceData({ guildId: 'guild-2', caseId: 'case-stale' })
  ).toBeNull();
  expect(state.detail).toHaveBeenCalledTimes(1);
  expect(state.request).toHaveBeenCalledTimes(1);
});

it('adjacent report completion does not retain pre-completion status and actions', async () => {
  let report = fixtureReportDetail('report-1')!;
  state.report.mockImplementation(async () => report);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_action_requests') ? [{ id: 'report-ban' }] : [],
  }));
  state.request.mockImplementation(async () => {
    report = { ...report, status: 'actioned', allowedActions: ['open_report_thread'] };
    return {
      ...caseReadRequest('completed'),
      id: 'report-ban',
      actionType: 'ban_observed_detection',
      requestedAction: 'ban_user',
      targetUserId: 'user-300',
      reportIntakeId: 'report-1',
      verificationEventId: null,
      detectionEventId: 'det-report-1',
      observedBanResult: { status: 'banned' },
    };
  });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'report:report-1',
  });
  expect(result).toMatchObject({
    kind: 'submitted_report',
    report: { status: 'actioned' },
    requests: [{ id: 'report-ban', status: 'completed' }],
  });
  expect(result?.policy.allowedActions).not.toContain('ban_user');
});
it('adjacent observed completion does not retain pre-completion alert status and actions', async () => {
  let row = {
    id: 'observed-read',
    server_id: 'guild-1',
    user_id: 'user-100',
    detection_type: 'gpt_analysis',
    confidence: 0.8,
    detected_at: null,
    reasons: ['Recorded source'],
    metadata: {},
    latest_verification_event_id: null,
    admin_action: null,
    admin_action_at: null,
    admin_action_by: null,
    channel_id: null,
    message_id: null,
    latest_accounting_action_type: null,
    latest_accounting_action_at: null,
  };
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from detection_events de')
      ? [row]
      : sql.includes('from moderation_action_requests')
        ? [{ id: 'observed-ban' }]
        : [],
  }));
  state.request.mockImplementation(async () => {
    row = { ...row, metadata: { observed_action: 'ban' } };
    return {
      ...caseReadRequest('completed'),
      id: 'observed-ban',
      actionType: 'ban_observed_detection',
      requestedAction: 'ban_user',
      verificationEventId: null,
      detectionEventId: 'observed-read',
      observedBanResult: { status: 'banned' },
    };
  });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'detection:observed-read',
  });
  expect(result).toMatchObject({
    kind: 'observed_alert',
    item: { statusLabel: 'ban' },
    requests: [{ id: 'observed-ban', status: 'completed' }],
  });
  expect(result?.policy.allowedActions).not.toContain('ban_user');
});

function observedReadRow() {
  return {
    id: 'observed-read',
    server_id: 'guild-1',
    user_id: 'user-100',
    detection_type: 'gpt_analysis',
    confidence: 0.8,
    detected_at: null,
    reasons: ['Recorded source'],
    metadata: {} as Record<string, unknown>,
    latest_verification_event_id: null as string | null,
    admin_action: null,
    admin_action_at: null,
    admin_action_by: null,
    channel_id: null,
    message_id: null,
    latest_accounting_action_type: null,
    latest_accounting_action_at: null,
  };
}
function observedReadRequest() {
  return {
    ...caseReadRequest('completed'),
    id: 'opening',
    actionType: 'open_case_from_observed_detection' as const,
    requestedAction: 'open_case',
    verificationEventId: null,
    detectionEventId: 'observed-read',
  };
}
it('keeps a null-case opening receipt and drops old-case receipts after a report gains a new case', async () => {
  let current = { ...fixtureReportDetail('report-1')!, latestCaseId: 'case-old' };
  state.report.mockImplementation(async () => current);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from moderation_action_requests')
      ? [{ id: 'opening' }, { id: 'old-case' }]
      : [],
  }));
  state.request.mockImplementation(async (_guild: string, id: string) => {
    current = { ...current, latestCaseId: 'case-new', allowedActions: ['open_report_thread'] };
    return {
      ...observedReadRequest(),
      id,
      reportIntakeId: 'report-1',
      targetUserId: 'user-300',
      detectionEventId: 'det-report-1',
      verificationEventId: id === 'old-case' ? 'case-old' : null,
    };
  });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'report:report-1',
  });
  expect(result).toMatchObject({
    kind: 'submitted_report',
    report: { latestCaseId: 'case-new' },
    requests: [{ id: 'opening', verificationEventId: null }],
  });
  expect(state.request).toHaveBeenCalledTimes(2);
});
it('uses fresh observed case and report links without attaching a no-longer-related receipt', async () => {
  let current = {
    ...observedReadRow(),
    latest_verification_event_id: 'case-old',
    metadata: { reportIntakeId: 'report-1' },
  };
  let linked = {
    ...fixtureReportDetail('report-1')!,
    targetUserId: 'user-100',
    latestDetectionId: 'observed-read',
  };
  state.report.mockImplementation(async () => linked);
  state.query.mockImplementation(async (sql: string) => ({
    rows: sql.includes('from detection_events de')
      ? [current]
      : sql.includes('from moderation_action_requests')
        ? [{ id: 'opening' }, { id: 'old-case' }, { id: 'old-report' }]
        : [],
  }));
  state.request.mockImplementation(async (_guild: string, id: string) => {
    current = { ...current, latest_verification_event_id: 'case-new' };
    linked = { ...linked, latestDetectionId: 'another-detection' };
    return {
      ...observedReadRequest(),
      id,
      reportIntakeId: id === 'old-report' ? 'report-1' : null,
      verificationEventId: id === 'old-case' ? 'case-old' : null,
    };
  });
  const result = await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
    guildId: 'guild-1',
    itemId: 'detection:observed-read',
  });
  expect(result).toMatchObject({
    kind: 'observed_alert',
    detection: { latestCaseId: 'case-new' },
    requests: [{ id: 'opening', verificationEventId: null }],
  });
  expect(state.request).toHaveBeenCalledTimes(3);
});
for (const kind of ['report', 'detection'] as const) {
  it.each(['missing', 'guild', 'record', 'member'] as const)(
    `${kind} rejects %s identity drift after terminal capture`,
    async (change) => {
      const report = fixtureReportDetail('report-1')!;
      const row = observedReadRow();
      let captured = false;
      state.report.mockImplementation(async () =>
        !captured
          ? report
          : change === 'missing'
            ? null
            : {
                ...report,
                guildId: change === 'guild' ? 'foreign' : report.guildId,
                id: change === 'record' ? 'foreign' : report.id,
                targetUserId: change === 'member' ? 'foreign' : report.targetUserId,
              }
      );
      state.query.mockImplementation(async (sql: string) => ({
        rows: sql.includes('from detection_events de')
          ? !captured
            ? [row]
            : change === 'missing'
              ? []
              : [
                  {
                    ...row,
                    server_id: change === 'guild' ? 'foreign' : row.server_id,
                    id: change === 'record' ? 'foreign' : row.id,
                    user_id: change === 'member' ? 'foreign' : row.user_id,
                  },
                ]
          : sql.includes('from moderation_action_requests')
            ? [{ id: 'opening' }]
            : [],
      }));
      state.request.mockImplementation(async () => {
        captured = true;
        return kind === 'report'
          ? {
              ...observedReadRequest(),
              reportIntakeId: 'report-1',
              targetUserId: 'user-300',
              detectionEventId: 'det-report-1',
            }
          : observedReadRequest();
      });
      expect(
        await createModerationWorkspaceDataAdapter(actor).getInboxItemDetail({
          guildId: 'guild-1',
          itemId: kind === 'report' ? 'report:report-1' : 'detection:observed-read',
        })
      ).toBeNull();
    }
  );
  it(`${kind} returns its queued capture unchanged and reads the later completed state on the next request`, async () => {
    let report = fixtureReportDetail('report-1')!;
    let row = observedReadRow();
    let status: 'queued' | 'completed' = 'queued';
    state.report.mockImplementation(async () => report);
    state.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes('from detection_events de')
        ? [row]
        : sql.includes('from moderation_action_requests')
          ? [{ id: 'opening' }]
          : [],
    }));
    state.request.mockImplementation(async () => {
      const captured = {
        ...observedReadRequest(),
        status,
        ...(kind === 'report'
          ? {
              reportIntakeId: 'report-1',
              targetUserId: 'user-300',
              detectionEventId: 'det-report-1',
            }
          : {}),
      };
      report = { ...report, status: 'actioned', allowedActions: ['open_report_thread'] };
      row = { ...row, metadata: { observed_action: 'ban' } };
      status = 'completed';
      return captured;
    });
    const adapter = createModerationWorkspaceDataAdapter(actor);
    const input = {
      guildId: 'guild-1',
      itemId: kind === 'report' ? 'report:report-1' : 'detection:observed-read',
    };
    expect(await adapter.getInboxItemDetail(input)).toMatchObject({
      requests: [{ status: 'queued' }],
    });
    expect(await adapter.getInboxItemDetail(input)).toMatchObject({
      requests: [{ status: 'completed' }],
      ...(kind === 'report'
        ? { report: { status: 'actioned' } }
        : { item: { statusLabel: 'ban' } }),
    });
    expect(state.request).toHaveBeenCalledTimes(2);
  });
}
