import { beforeEach, expect, it, vi } from 'vitest';
import {
  closeInboxSubmittedReport,
  openInboxSubmittedReportCase,
} from '@/app/admin/guild/[guildId]/reports/actions';
import { initialInboxActionState } from './inboxActionState';

const runtime = vi.hoisted(() => ({
  assertCanManageGuild: vi.fn(async () => undefined),
  closeSubmittedReport: vi.fn(async () => true),
  openCaseFromSubmittedReport: vi.fn(async () => ({
    status: 'queued',
    requestId: 'queued-request-1',
  })),
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: runtime.assertCanManageGuild }),
}));
vi.mock('@/lib/reportQueueDataAdapter', () => ({
  createReportQueueDataAdapter: () => ({
    closeSubmittedReport: runtime.closeSubmittedReport,
    openCaseFromSubmittedReport: runtime.openCaseFromSubmittedReport,
  }),
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: async () => ({ userId: 'session-moderator-1' }),
  getCurrentDiscordToken: async () => ({ accessToken: 'session-token' }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  runtime.assertCanManageGuild.mockResolvedValue(undefined);
});
it('retains the Manage Server dashboard gate before report closure', async () => {
  runtime.assertCanManageGuild.mockRejectedValue(new Error('Manage Server required'));
  const result = await closeInboxSubmittedReport(
    'guild-1',
    'report-1',
    'mark_actioned',
    initialInboxActionState,
    new FormData()
  );
  expect(result).toMatchObject({ status: 'failed', message: 'Manage Server required' });
  expect(runtime.closeSubmittedReport).not.toHaveBeenCalled();
});
it('retains the dashboard gate before report-case submission', async () => {
  runtime.assertCanManageGuild.mockRejectedValue(new Error('Manage Server required'));
  const result = await openInboxSubmittedReportCase(
    'guild-1',
    'report-1',
    initialInboxActionState,
    new FormData()
  );
  expect(result.status).toBe('failed');
  expect(runtime.openCaseFromSubmittedReport).not.toHaveBeenCalled();
});
it('uses the session identity for direct closure and retains queued case receipts', async () => {
  const closure = await closeInboxSubmittedReport(
    'guild-1',
    'report-1',
    'mark_actioned',
    initialInboxActionState,
    new FormData()
  );
  expect(closure).toMatchObject({ status: 'completed', requestId: null });
  expect(runtime.closeSubmittedReport).toHaveBeenCalledWith(
    expect.objectContaining({
      guildId: 'guild-1',
      source: 'web',
      actor: { kind: 'user', userId: 'session-moderator-1' },
    }),
    { reportId: 'report-1', action: 'mark_actioned' }
  );
  expect(
    await openInboxSubmittedReportCase(
      'guild-1',
      'report-1',
      initialInboxActionState,
      new FormData()
    )
  ).toMatchObject({ status: 'queued', requestId: 'queued-request-1' });
});
