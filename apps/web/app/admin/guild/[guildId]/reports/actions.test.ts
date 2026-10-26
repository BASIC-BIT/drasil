import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitWorkspaceReportAction } from './actions';
const m = vi.hoisted(() => ({
  fixture: false,
  cookies: { set: vi.fn() },
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  detail: vi.fn(),
  server: vi.fn(),
  resources: vi.fn(),
  queue: vi.fn(),
  revalidate: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => m.cookies }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error(path), { digest: 'NEXT_REDIRECT;replace' });
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: m.session,
  getCurrentDiscordToken: m.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: m.guild }),
}));
vi.mock('@/lib/setupDataAdapter', () => ({
  createSetupDataAdapter: () => ({ getServer: m.server }),
  getPostgresPool: () => ({ query: m.queue }),
}));
vi.mock('@/lib/reportDetailDataAdapter', () => ({
  createReportDetailDataAdapter: () => ({ getReportDetail: m.detail }),
}));
vi.mock('@/lib/discordApi', () => ({ fetchGuildResources: m.resources }));
vi.mock('@/lib/e2eFixtures', () => ({ isWebE2eFixtureMode: () => m.fixture }));
vi.mock('@/lib/reportQueueDataAdapter', () => ({
  createReportQueueDataAdapter: () => ({
    closeSubmittedReport: m.close,
    openCaseFromSubmittedReport: m.open,
  }),
}));
function form(changes: Partial<Record<string, string>> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    confirmAction: 'on',
    confirmedTargetUserId: 'user-1',
    confirmedRecordId: 'report-1',
    reason: 'Reviewed spam',
    ...changes,
  }))
    if (value !== undefined) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.fixture = false;
  m.session.mockResolvedValue({ userId: 'admin-1' });
  m.token.mockResolvedValue({ accessToken: 'token' });
  m.guild.mockResolvedValue({ id: 'guild-1', owner: false, permissions: '4' });
  m.detail.mockResolvedValue({
    id: 'report-1',
    guildId: 'guild-1',
    targetUserId: 'user-1',
    latestDetectionId: 'det-1',
    status: 'submitted',
    allowedActions: ['ban_user'],
  });
  m.server.mockResolvedValue({ settings: { moderator_ban_action_requires_reason: true } });
  m.resources.mockResolvedValue({
    botMember: { roles: [] },
    roles: [{ id: 'guild-1', permissions: '4' }],
  });
  m.queue.mockResolvedValue({ rows: [{ id: 'request-1', status: 'queued' }] });
});
describe('confirmed report ban', () => {
  it('reloads the report and queues its server-side target with a receipt', async () => {
    const data = form();
    data.set('targetUserId', 'attacker');
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        data
      )
    ).toMatchObject({
      kind: 'request',
      receipt: { status: 'queued', id: 'request-1' },
    });
    const values = m.queue.mock.calls[0][1];
    expect(values).toEqual([
      'guild-1',
      'ban_observed_detection',
      'admin-1',
      'web_report',
      'user-1',
      'det-1',
      'report-1',
      null,
      null,
      'observed-ban:guild-1:det-1',
      JSON.stringify({ reason: 'Reviewed spam', requested_action: 'ban_user' }),
    ]);
    expect(m.revalidate.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        '/admin/guild/guild-1/inbox',
        '/admin/guild/guild-1/reports',
        '/admin/guild/guild-1/reports/report-1',
      ])
    );
  });
  it.each(['', '   '])('queues an empty optional reason without defaulting %j', async (reason) => {
    m.server.mockResolvedValue({ settings: { moderator_ban_action_requires_reason: false } });
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form({ reason })
      )
    ).toMatchObject({
      kind: 'request',
      receipt: { status: 'queued', id: 'request-1' },
    });
    expect(m.queue).toHaveBeenCalledTimes(1);
    const values = m.queue.mock.calls[0][1];
    expect(values[10]).toBe(JSON.stringify({ reason: '', requested_action: 'ban_user' }));
  });
  it.each([{ confirmAction: '' }, { reason: '' }, { confirmedTargetUserId: 'changed' }])(
    'rejects invalid confirmation %j',
    async (changes) => {
      expect(
        await submitWorkspaceReportAction(
          { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
          form(changes)
        )
      ).toMatchObject({
        kind: 'failed',
      });
      expect(m.queue).not.toHaveBeenCalled();
    }
  );
  it.each([
    null,
    { status: 'dismissed', allowedActions: [] },
    { status: 'submitted', allowedActions: [] },
  ])('rejects a stale or busy report %j', async (detail) => {
    m.detail.mockResolvedValue(detail);
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form()
      )
    ).toMatchObject({
      kind: 'failed',
    });
    expect(m.queue).not.toHaveBeenCalled();
  });
  it('returns to the same report after authentication', async () => {
    m.session.mockResolvedValue(null);
    await expect(
      submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form()
      )
    ).rejects.toThrow('/api/auth/discord?returnTo=%2Fadmin%2Fguild%2Fguild-1%2Freports%2Freport-1');
  });
  it('requires Ban Members independently of guild management', async () => {
    m.guild.mockResolvedValue({ id: 'guild-1', owner: false, permissions: '32' });
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form()
      )
    ).toMatchObject({
      kind: 'failed',
    });
    expect(m.queue).not.toHaveBeenCalled();
  });
  it('allows recovery after queue failure', async () => {
    m.queue.mockRejectedValueOnce(new Error('Queue unavailable'));
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form()
      )
    ).toMatchObject({
      kind: 'failed',
      message: 'Queue unavailable',
    });
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        form()
      )
    ).toMatchObject({
      kind: 'request',
      receipt: { status: 'queued' },
    });
  });
  it.each(['disabled', 'bot-permission', 'long-reason'])(
    'rejects unavailable policy %s',
    async (kind) => {
      if (kind === 'disabled')
        m.server.mockResolvedValue({ settings: { moderator_ban_action_enabled: false } });
      if (kind === 'bot-permission')
        m.resources.mockResolvedValue({ botMember: { roles: [] }, roles: [] });
      expect(
        await submitWorkspaceReportAction(
          { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
          form(kind === 'long-reason' ? { reason: 'x'.repeat(501) } : {})
        )
      ).toMatchObject({ kind: 'failed' });
      expect(m.queue).not.toHaveBeenCalled();
    }
  );
});

describe('workspace report action boundary', () => {
  function confirmed() {
    const data = form();
    data.set('confirmedRecordId', 'report-1');
    return data;
  }
  beforeEach(() => {
    m.detail.mockResolvedValue({
      id: 'report-1',
      guildId: 'guild-1',
      targetUserId: 'user-1',
      latestDetectionId: 'det-1',
      status: 'submitted',
      allowedActions: [
        'ban_user',
        'open_case',
        'mark_actioned',
        'dismiss_no_action',
        'mark_false_positive',
      ],
    });
    m.close.mockResolvedValue({
      actor: { id: 'admin-1', surface: 'web' },
      action: 'dismiss_no_action',
      reportId: 'report-1',
      reportStatus: 'dismissed',
      status: 'closed',
      queueCleanupStatus: 'failed',
    });
  });
  it.each([
    'mark_actioned',
    'dismiss_no_action',
    'mark_false_positive',
    'open_case',
    'ban_user',
  ] as const)('requires confirmation for report %s', async (action) => {
    const { submitWorkspaceReportAction } = await import('./actions');
    const data = confirmed();
    data.delete('confirmAction');
    expect(
      await submitWorkspaceReportAction({ guildId: 'guild-1', reportId: 'report-1', action }, data)
    ).toMatchObject({ kind: 'failed' });
    expect(m.queue).not.toHaveBeenCalled();
    expect(m.close).not.toHaveBeenCalled();
    expect(m.open).not.toHaveBeenCalled();
  });
  it.each(['confirmedRecordId', 'confirmedTargetUserId'])(
    'rejects report mismatch %s before mutation',
    async (field) => {
      const { submitWorkspaceReportAction } = await import('./actions');
      const data = confirmed();
      data.set(field, 'wrong');
      expect(
        await submitWorkspaceReportAction(
          { guildId: 'guild-1', reportId: 'report-1', action: 'dismiss_no_action' },
          data
        )
      ).toMatchObject({ kind: 'failed' });
      expect(m.close).not.toHaveBeenCalled();
    }
  );
  it.each([{ guildId: 'other-guild' }, { allowedActions: [] }])(
    'rejects cross-guild and stale reports',
    async (changes) => {
      const { submitWorkspaceReportAction } = await import('./actions');
      m.detail.mockResolvedValue({
        id: 'report-1',
        guildId: 'guild-1',
        targetUserId: 'user-1',
        status: 'submitted',
        allowedActions: ['dismiss_no_action'],
        ...changes,
      });
      expect(
        await submitWorkspaceReportAction(
          { guildId: 'guild-1', reportId: 'report-1', action: 'dismiss_no_action' },
          confirmed()
        )
      ).toMatchObject({ kind: 'failed' });
      expect(m.close).not.toHaveBeenCalled();
    }
  );
  it('allows targetless report closure and preserves closed with cleanup failure', async () => {
    const { submitWorkspaceReportAction } = await import('./actions');
    m.detail.mockResolvedValue({
      id: 'report-1',
      guildId: 'guild-1',
      targetUserId: null,
      status: 'submitted',
      allowedActions: ['dismiss_no_action'],
    });
    const data = confirmed();
    data.delete('confirmedTargetUserId');
    const closedWithCleanupFailure = await submitWorkspaceReportAction(
      { guildId: 'guild-1', reportId: 'report-1', action: 'dismiss_no_action' },
      data
    );
    expect(closedWithCleanupFailure).toMatchObject({
      kind: 'report_closure',
      result: { status: 'closed', queueCleanupStatus: 'failed' },
    });
  });
  it('retains report ban reason policy with contextual confirmation', async () => {
    const { submitWorkspaceReportAction } = await import('./actions');
    const data = confirmed();
    data.delete('reason');
    expect(
      await submitWorkspaceReportAction(
        { guildId: 'guild-1', reportId: 'report-1', action: 'ban_user' },
        data
      )
    ).toMatchObject({ kind: 'failed', message: 'Ban reason is required.' });
    expect(m.queue).not.toHaveBeenCalled();
  });
});
