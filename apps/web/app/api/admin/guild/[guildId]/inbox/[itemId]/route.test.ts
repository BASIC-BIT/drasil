import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const state = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: state.session,
  getCurrentDiscordToken: state.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: state.guild }),
}));
vi.mock('@/lib/moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: () => ({ getInboxItemDetail: state.detail }),
}));
import { GET } from './route';
const request = () =>
  GET(new NextRequest('https://drasil.example/api/admin/guild/guild-1/inbox/case:case-1'), {
    params: Promise.resolve({ guildId: 'guild-1', itemId: 'case:case-1' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  state.session.mockResolvedValue({ userId: 'admin' });
  state.token.mockResolvedValue({ accessToken: 'token' });
  state.guild.mockResolvedValue({ id: 'guild-1', owner: true, permissions: '8' });
  state.detail.mockResolvedValue(null);
});
it('returns 401 without a session', async () => {
  state.session.mockResolvedValue(null);
  expect((await request()).status).toBe(401);
  expect(state.detail).not.toHaveBeenCalled();
});
it('returns 403 for guild denial without exposing the thrown error', async () => {
  state.guild.mockRejectedValue(new Error('private metadata'));
  const response = await request();
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain('private metadata');
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
