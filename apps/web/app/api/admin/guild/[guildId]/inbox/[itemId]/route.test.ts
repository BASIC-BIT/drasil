import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { AuthorityFacts } from '@drasil/application';
const state = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  detail: vi.fn(),
  authority: vi.fn(),
  adapter: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: state.session,
  getCurrentDiscordToken: state.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: state.guild }),
}));
vi.mock('@/lib/application/adapters/authority', () => ({
  createWebAuthority: () => ({ loadFresh: state.authority }),
}));
vi.mock('@/lib/moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: state.adapter,
}));
import { GET } from './route';
const request = () =>
  GET(new NextRequest('https://drasil.example/api/admin/guild/guild-1/inbox/case:case-1'), {
    params: Promise.resolve({ guildId: 'guild-1', itemId: 'case:case-1' }),
  });
const freshActor: AuthorityFacts = {
  guildId: 'guild-1',
  userId: 'admin',
  present: true,
  owner: false,
  permissions: '32',
  roleIds: ['configured-moderator', 'configured-reviewer'],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.session.mockResolvedValue({ userId: 'admin' });
  state.token.mockResolvedValue({ accessToken: 'token' });
  state.guild.mockResolvedValue({ id: 'guild-1', owner: true, permissions: '8' });
  state.authority.mockResolvedValue(freshActor);
  state.adapter.mockReturnValue({ getInboxItemDetail: state.detail });
  state.detail.mockResolvedValue(null);
});
it.each(['session', 'token'] as const)(
  'returns 401 without a %s before any guild read',
  async (missing) => {
    state[missing].mockResolvedValue(null);
    const response = await request();
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(state.guild).not.toHaveBeenCalled();
    expect(state.authority).not.toHaveBeenCalled();
    expect(state.adapter).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
  }
);
it('retains the manageable-guild gate before loading fresh authority or detail', async () => {
  state.guild.mockRejectedValue(new Error('private metadata'));
  const response = await request();
  expect(response.status).toBe(403);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.text()).not.toContain('private metadata');
  expect(state.guild).toHaveBeenCalledExactlyOnceWith('guild-1', 'token');
  expect(state.authority).not.toHaveBeenCalled();
  expect(state.adapter).not.toHaveBeenCalled();
  expect(state.detail).not.toHaveBeenCalled();
});
it('passes exact fresh authority and configured roles to the detail adapter instead of OAuth facts', async () => {
  await request();
  expect(state.authority).toHaveBeenCalledExactlyOnceWith('guild-1', 'admin');
  expect(state.adapter).toHaveBeenCalledExactlyOnceWith({
    guildId: 'guild-1',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '32',
    roleIds: ['configured-moderator', 'configured-reviewer'],
  });
  expect(state.detail).toHaveBeenCalledExactlyOnceWith({
    guildId: 'guild-1',
    itemId: 'case:case-1',
  });
});
it('reloads authority on each request so removed roles are not reused', async () => {
  state.authority.mockResolvedValueOnce(freshActor).mockResolvedValueOnce({
    ...freshActor,
    permissions: '0',
    roleIds: [],
  });
  await request();
  await request();
  expect(state.authority).toHaveBeenCalledTimes(2);
  expect(state.adapter).toHaveBeenNthCalledWith(2, {
    guildId: 'guild-1',
    userId: 'admin',
    present: true,
    owner: false,
    permissions: '0',
    roleIds: [],
  });
});
it.each([
  { label: 'missing', actor: null },
  { label: 'absent', actor: { ...freshActor, present: false } },
  { label: 'another guild', actor: { ...freshActor, guildId: 'guild-2' } },
  { label: 'another user', actor: { ...freshActor, userId: 'other-admin' } },
])(
  'rejects $label authority before constructing an adapter or reading detail',
  async ({ actor }) => {
    state.authority.mockResolvedValue(actor);
    const response = await request();
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ error: 'Guild access denied.' });
    expect(state.adapter).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
  }
);
it('handles a fresh-authority lookup failure safely without caching or reading detail', async () => {
  state.authority.mockRejectedValue(new Error('private authority token metadata'));
  const response = await request();
  expect(response.status).toBe(500);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(await response.json()).toEqual({ error: 'Unable to load inbox item.' });
  expect(state.adapter).not.toHaveBeenCalled();
  expect(state.detail).not.toHaveBeenCalled();
});
it('returns 404 without matching detail and prevents shared caching', async () => {
  const response = await request();
  expect(response.status).toBe(404);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('rejects invalid composed JSON without returning raw metadata', async () => {
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
