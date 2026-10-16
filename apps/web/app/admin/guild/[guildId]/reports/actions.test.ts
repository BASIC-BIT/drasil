import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  detail: vi.fn(),
  server: vi.fn(),
  resources: vi.fn(),
  queue: vi.fn(),
  revalidate: vi.fn(),
}));
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
}));
vi.mock('@/lib/reportDetailDataAdapter', () => ({
  createReportDetailDataAdapter: () => ({ getReportDetail: m.detail }),
}));
vi.mock('@/lib/discordApi', () => ({ fetchGuildResources: m.resources }));
vi.mock('@/lib/moderationActionRequestQueue', () => ({
  queueModerationActionRequestWithReceipt: m.queue,
}));
vi.mock('@/lib/e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('@/lib/reportQueueDataAdapter', () => ({ createReportQueueDataAdapter: vi.fn() }));
import { banSubmittedReport } from './actions';
const idle = { status: 'idle', message: null, requestId: null } as const;
function form(changes: Partial<Record<string, string>> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    confirmAction: 'on',
    confirmedTargetUserId: 'user-1',
    reason: 'Reviewed spam',
    ...changes,
  }))
    if (value !== undefined) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
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
  m.queue.mockResolvedValue({ id: 'request-1', status: 'queued' });
});
describe('banSubmittedReport', () => {
  it('reloads the report and queues its server-side target with a receipt', async () => {
    const data = form();
    data.set('targetUserId', 'attacker');
    expect(await banSubmittedReport('guild-1', 'report-1', idle, data)).toMatchObject({
      status: 'queued',
      requestId: 'request-1',
    });
    expect(m.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'guild-1',
        targetUserId: 'user-1',
        reportIntakeId: 'report-1',
        detectionEventId: 'det-1',
        actionType: 'ban_observed_detection',
        actorId: 'admin-1',
        actorSurface: 'web_report',
        idempotencyKey: 'observed-ban:guild-1:det-1',
        metadata: { reason: 'Reviewed spam', requested_action: 'ban_user' },
      })
    );
    expect(m.revalidate.mock.calls.flat()).toEqual(
      expect.arrayContaining([
        '/admin/guild/guild-1/inbox',
        '/admin/guild/guild-1/reports',
        '/admin/guild/guild-1/reports/report-1',
      ])
    );
  });
  it.each([{ confirmAction: '' }, { reason: '' }, { confirmedTargetUserId: 'changed' }])(
    'rejects invalid confirmation %j',
    async (changes) => {
      expect(await banSubmittedReport('guild-1', 'report-1', idle, form(changes))).toMatchObject({
        status: 'failed',
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
    expect(await banSubmittedReport('guild-1', 'report-1', idle, form())).toMatchObject({
      status: 'failed',
    });
    expect(m.queue).not.toHaveBeenCalled();
  });
  it('returns to the same report after authentication', async () => {
    m.session.mockResolvedValue(null);
    await expect(banSubmittedReport('guild-1', 'report-1', idle, form())).rejects.toThrow(
      '/api/auth/discord?returnTo=/admin/guild/guild-1/reports/report-1'
    );
  });
  it('requires Ban Members independently of guild management', async () => {
    m.guild.mockResolvedValue({ id: 'guild-1', owner: false, permissions: '32' });
    expect(await banSubmittedReport('guild-1', 'report-1', idle, form())).toMatchObject({
      status: 'failed',
    });
    expect(m.queue).not.toHaveBeenCalled();
  });
  it('allows recovery after queue failure', async () => {
    m.queue.mockRejectedValueOnce(new Error('Queue unavailable'));
    expect(await banSubmittedReport('guild-1', 'report-1', idle, form())).toMatchObject({
      status: 'failed',
      message: 'Queue unavailable',
    });
    expect(await banSubmittedReport('guild-1', 'report-1', idle, form())).toMatchObject({
      status: 'queued',
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
        await banSubmittedReport(
          'guild-1',
          'report-1',
          idle,
          form(kind === 'long-reason' ? { reason: 'x'.repeat(501) } : {})
        )
      ).toMatchObject({ status: 'failed' });
      expect(m.queue).not.toHaveBeenCalled();
    }
  );
});
