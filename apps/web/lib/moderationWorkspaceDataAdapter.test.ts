import { beforeEach, expect, it, vi } from 'vitest';
import { fixtureCaseDetails } from './caseFixtures';
import { fixtureReportDetail } from './reportFixtures';
import {
  fixtureMessageCleanupCaseWorkspaces,
  fixtureMessageCleanupJobDetails,
} from './messageCleanupFixtures';
import { createModerationWorkspaceDataAdapter } from './moderationWorkspaceDataAdapter';
import { workspaceItemDetailSchema } from './moderationWorkspaceTypes';
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
