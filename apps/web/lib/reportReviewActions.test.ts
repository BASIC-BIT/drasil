import { beforeEach, expect, it, vi } from 'vitest';
import {
  closeInboxSubmittedReport,
  openInboxSubmittedReportCase,
} from '@/app/admin/guild/[guildId]/reports/actions';
import { PostgresQueuedReportCaseOpener } from './application/adapters/reportReview';
import { initialInboxActionState } from './inboxActionState';

const runtime = vi.hoisted(() => ({
  query: vi.fn(),
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
vi.mock('@/lib/setupDataAdapter', () => ({ getPostgresPool: () => ({ query: runtime.query }) }));
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

it.each(['queued', 'completed', 'failed'] as const)(
  'preserves report-case bindings and maps the %s persistence receipt',
  async (status) => {
    runtime.query.mockResolvedValueOnce({ rows: [{ id: 'request-1', status }] });
    const result = new PostgresQueuedReportCaseOpener().openObservedDetectionCase(
      {
        guildId: 'guild-1',
        requestId: 'detection-1',
        source: 'web',
        actor: { kind: 'user', userId: 'moderator-1' },
      },
      { detectionEventId: 'detection-1', reportId: 'report-1', userId: 'user-1' }
    );
    if (status === 'failed')
      await expect(result).rejects.toThrow(
        'Report case action could not be queued. Refresh the inbox and try again.'
      );
    else
      await expect(result).resolves.toEqual({
        requestId: 'request-1',
        status: status === 'completed' ? 'already_handled' : 'queued',
      });
    expect(runtime.query.mock.calls[0][1]).toEqual([
      'guild-1',
      'open_case_from_observed_detection',
      'moderator-1',
      'web',
      'user-1',
      'detection-1',
      'report-1',
      null,
      null,
      'web:report-open-case:guild-1:report-1:detection-1',
      JSON.stringify({ requested_surface: 'web', report_intake_id: 'report-1' }),
    ]);
  }
);
