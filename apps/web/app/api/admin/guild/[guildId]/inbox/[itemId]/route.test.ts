import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { ReadDependencyUnavailableError } from '@drasil/application';
const state = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  identity: vi.fn(),
  directory: vi.fn(),
  guild: vi.fn(),
  member: vi.fn(),
  roles: vi.fn(),
  detail: vi.fn(),
  adapter: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: state.session,
  getCurrentDiscordToken: state.token,
}));
vi.mock('@/lib/discordApi', async (original) => ({
  ...(await original<typeof import('@/lib/discordApi')>()),
  fetchDiscordUser: state.identity,
  fetchDiscordGuilds: state.directory,
  fetchDiscordGuild: state.guild,
  fetchDiscordGuildMember: state.member,
  fetchDiscordGuildRoles: state.roles,
}));
vi.mock('@/lib/moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: state.adapter,
}));
import { DiscordApiError } from '@/lib/discordApi';
import { GET } from './route';
const request = () =>
  GET(new NextRequest('https://drasil.example/api/admin/guild/guild-1/inbox/case:case-1'), {
    params: Promise.resolve({ guildId: 'guild-1', itemId: 'case:case-1' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  state.session.mockResolvedValue({ userId: 'admin', expiresAt: Date.now() + 60000 });
  state.token.mockResolvedValue({ accessToken: 'token', expiresAt: Date.now() + 60000 });
  state.identity.mockResolvedValue({ id: 'admin', username: 'Admin' });
  state.directory.mockRejectedValue(new ReadDependencyUnavailableError({}));
  state.guild.mockResolvedValue({ id: 'guild-1', name: 'Selected server', owner_id: 'other' });
  state.member.mockResolvedValue({ user: { id: 'admin' }, roles: ['staff'] });
  state.roles.mockResolvedValue([
    { id: 'guild-1', permissions: '32' },
    { id: 'staff', permissions: '0' },
  ]);
  state.adapter.mockReturnValue({ getInboxItemDetail: state.detail });
  state.detail.mockResolvedValue(null);
});
async function failure(status: number, code: string) {
  const response = await request();
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ code });
  expect(state.adapter).not.toHaveBeenCalled();
  expect(state.detail).not.toHaveBeenCalled();
  return response;
}
it.each(['session', 'token'] as const)(
  'requires local %s before provider reads',
  async (missing) => {
    state[missing].mockResolvedValue(null);
    await failure(401, 'authentication_required');
    expect(state.identity).not.toHaveBeenCalled();
    expect(state.guild).not.toHaveBeenCalled();
  }
);
it('uses live identity and selected authority even when guild enumeration fails', async () => {
  expect((await request()).status).toBe(404);
  expect(state.identity).toHaveBeenCalledExactlyOnceWith('token');
  expect(state.directory).not.toHaveBeenCalled();
  expect(state.adapter).toHaveBeenCalledWith(
    expect.objectContaining({
      guildId: 'guild-1',
      userId: 'admin',
      permissions: '32',
      roleIds: ['staff'],
    })
  );
});
it('checks live OAuth revocation before authority', async () => {
  state.identity.mockRejectedValue(new DiscordApiError(401, 'private token'));
  await failure(401, 'authentication_required');
  expect(state.guild).not.toHaveBeenCalled();
});
it('denies identity mismatch before authority', async () => {
  state.identity.mockResolvedValue({ id: 'different' });
  await failure(403, 'access_denied');
  expect(state.guild).not.toHaveBeenCalled();
});
it.each([
  ['owner', '0', true, 404],
  ['administrator', '8', false, 404],
  ['manage server', '32', false, 404],
  ['staff role only', '0', false, 403],
  ['moderate members only', '1099511627776', false, 403],
] as const)('uses fresh %s admission', async (_label, permissions, owner, status) => {
  state.guild.mockResolvedValue({
    id: 'guild-1',
    name: 'Selected server',
    owner_id: owner ? 'admin' : 'other',
  });
  state.roles.mockResolvedValue([{ id: 'guild-1', permissions }]);
  expect((await request()).status).toBe(status);
  if (status === 403) expect(state.adapter).not.toHaveBeenCalled();
});
it('refreshes permissions each request and denies removed grants', async () => {
  expect((await request()).status).toBe(404);
  state.roles.mockResolvedValue([{ id: 'guild-1', permissions: '0' }]);
  expect((await request()).status).toBe(403);
  expect(state.identity).toHaveBeenCalledTimes(2);
  expect(state.guild).toHaveBeenCalledTimes(2);
  expect(state.adapter).toHaveBeenCalledTimes(1);
});
it.each(['guild', 'member'] as const)('rejects mismatched %s binding', async (source) => {
  if (source === 'guild') state.guild.mockResolvedValue({ id: 'other-guild', owner_id: 'admin' });
  else state.member.mockResolvedValue({ user: { id: 'other-user' }, roles: [] });
  await failure(403, 'access_denied');
});
it.each([
  ['member', 404, 403, 'access_denied'],
  ['member', 403, 503, 'unavailable'],
  ['guild', 404, 503, 'unavailable'],
  ['roles', 404, 503, 'unavailable'],
  ['guild', 403, 503, 'unavailable'],
  ['roles', 403, 503, 'unavailable'],
] as const)('classifies %s %s without an item404', async (source, providerStatus, status, code) => {
  state[source].mockRejectedValue(new DiscordApiError(providerStatus, 'private provider body'));
  await failure(status, code);
});
it.each(['identity', 'guild', 'member', 'roles'] as const)(
  'fails closed on %s unavailability',
  async (source) => {
    state[source].mockRejectedValue(new ReadDependencyUnavailableError({ retryAfterSeconds: 2 }));
    expect((await failure(503, 'unavailable')).headers.get('Retry-After')).toBe('2');
  }
);
it.each([NaN, Infinity, -1, 0, 86400])(
  'omits invalid or unbounded retry advice %s',
  async (retryAfterSeconds) => {
    state.identity.mockRejectedValue(new ReadDependencyUnavailableError({ retryAfterSeconds }));
    expect((await failure(503, 'unavailable')).headers.get('Retry-After')).toBeNull();
  }
);
it('sanitizes unexpected errors as500 rather than denial or provider outage', async () => {
  state.guild.mockRejectedValue(new Error('private authority metadata'));
  const response = await failure(500, 'internal_error');
  expect(response.status).toBe(500);
});
it('returns real404 only after successful authority and sets no-store', async () => {
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: 'not_found' });
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(state.detail).toHaveBeenCalledExactlyOnceWith({
    guildId: 'guild-1',
    itemId: 'case:case-1',
  });
});
it('rejects invalid composed JSON without raw metadata', async () => {
  state.detail.mockResolvedValue({ metadata: 'private' });
  const response = await request();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private');
});

import { fixtureCaseDetails } from '@/lib/caseFixtures';
import { fixtureReportDetail } from '@/lib/reportFixtures';
import { fixtureModerationInboxItems } from '@/lib/inboxFixtures';
const policy = {
  allowedActions: [],
  canQueueCaseActions: false,
  canOpenReportCases: false,
  canManageCleanup: false,
  kickReasonRequired: false,
  banReasonRequired: false,
};
const item = fixtureModerationInboxItems()[0];
const report = fixtureReportDetail('report-1');
const reply = { kind: 'unavailable', sourceUrl: null };
it.each([
  {
    kind: 'case',
    data: {
      detail: fixtureCaseDetails[0],
      report: null,
      membership: null,
      requests: [],
      cleanup: null,
      policy,
      loadedAt: '2026-10-25T00:00:00.000Z',
    },
  },
  { kind: 'submitted_report', report, requests: [] },
  {
    kind: 'observed_alert',
    detection: {
      id: 'det',
      detectionType: 'suspicious_content',
      confidence: 0.8,
      detectedAt: '2026-10-21T14:40:00.000Z',
      reasons: ['complete reasons'],
      latestCaseId: null,
      accounting: {
        excluded: false,
        scope: null,
        reason: null,
        excludedBy: null,
        excludedAt: null,
      },
      observedAction: null,
      observedActionAt: null,
      observedActionBy: null,
      sourceChannelId: null,
      sourceMessageId: null,
      sourceMessageUrl: null,
    },
    requests: [],
  },
  { kind: 'report_attention', intake: { ...report, status: 'collecting_evidence' }, reply },
  { kind: 'support_attention', subtype: 'quarantine_breach', caseData: null, reply },
  {
    kind: 'pending_screening',
    screening: { pendingSince: null, thresholdDays: null, lastCheckedAt: null },
  },
])('returns a validated $kind read with no shared cache or raw metadata', async (branch) => {
  state.detail.mockResolvedValue({
    ...branch,
    item: { ...item, kind: branch.kind },
    policy,
    metadata: { private: true },
  });
  const response = await request();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  expect(body.kind).toBe(branch.kind);
  expect(body).not.toHaveProperty('metadata');
});
