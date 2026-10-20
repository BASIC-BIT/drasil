import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guilds: vi.fn(),
  server: vi.fn(),
  openIntake: vi.fn(),
  queue: vi.fn(),
  query: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: m.session,
  getCurrentDiscordToken: m.token,
}));
vi.mock('@/lib/discordApi', () => ({ fetchDiscordGuilds: m.guilds }));
vi.mock('@/lib/setupDataAdapter', () => ({
  createSetupDataAdapter: () => ({ getServer: m.server }),
  getPostgresPool: () => ({ query: m.query }),
}));
vi.mock('@/lib/reportIntakePortalDataAdapter', () => ({ loadReporterOpenIntake: m.openIntake }));
vi.mock('@/lib/moderationActionRequestQueue', () => ({ queueModerationActionRequest: m.queue }));
vi.mock('@/lib/e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
import {
  submitUserReportFromWeb,
  startGuidedReportIntakeFromWeb,
  closeOpenReportIntakeFromWeb,
} from './actions';
const intakeId = '00000000-0000-4000-8000-000000000001';
function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ userId: 'reporter' });
  m.token.mockResolvedValue({ accessToken: 'token' });
  m.guilds.mockResolvedValue([{ id: 'guild' }]);
  m.server.mockResolvedValue({
    is_active: true,
    settings: { report_instructions_channel_id: 'channel' },
  });
  m.openIntake.mockResolvedValue({ id: intakeId });
  m.queue.mockResolvedValue('queued');
  m.query.mockResolvedValue({ rows: [] });
});
it('uses authenticated reporter identity and codec metadata for submitted user reports', async () => {
  await expect(
    submitUserReportFromWeb(
      'guild',
      form({
        targetUserId: '123456789012345678',
        confirmReport: 'on',
        actorId: 'staff',
        closedByStaff: 'true',
        reason: 'evidence',
      })
    )
  ).rejects.toThrow('/report/guild/guild?queued=1');
  expect(m.queue).toHaveBeenCalledWith(
    expect.objectContaining({
      actorId: 'reporter',
      actorSurface: 'web_report',
      targetUserId: '123456789012345678',
      metadata: {
        report_action: 'submit_user_report',
        requested_surface: 'web_report',
        reason: 'evidence',
        target_label: '123456789012345678',
      },
    })
  );
});
it('requires current reason policy and an authenticated confirmation before admission', async () => {
  m.server.mockResolvedValue({ is_active: true, settings: { user_report_reason_required: true } });
  await expect(
    submitUserReportFromWeb(
      'guild',
      form({ targetUserId: '123456789012345678', confirmReport: 'on' })
    )
  ).rejects.toThrow('requires a report reason');
  await expect(
    submitUserReportFromWeb(
      'guild',
      form({ targetUserId: '123456789012345678', reason: 'evidence' })
    )
  ).rejects.toThrow('Confirm the report');
  expect(m.queue).not.toHaveBeenCalled();
});
it('binds closure to the authenticated reporter current intake', async () => {
  m.openIntake.mockResolvedValue({ id: 'another-intake' });
  await expect(
    closeOpenReportIntakeFromWeb(
      'guild',
      form({ reportIntakeId: intakeId, confirmCloseIntake: 'on' })
    )
  ).rejects.toThrow('no longer available');
  expect(m.openIntake).toHaveBeenCalledWith(
    expect.objectContaining({ actor: { kind: 'user', userId: 'reporter' } })
  );
  expect(m.queue).not.toHaveBeenCalled();
});
it('keeps guided creation durable and resolves the configured channel server side', async () => {
  await expect(
    startGuidedReportIntakeFromWeb('guild', form({ channelId: 'spoofed' }))
  ).rejects.toThrow('guided=queued');
  expect(m.queue).toHaveBeenCalledWith(
    expect.objectContaining({
      actionType: 'start_report_intake',
      targetUserId: null,
      metadata: {
        channel_id: 'channel',
        report_action: 'start_report_intake',
        requested_surface: 'web_report',
      },
    })
  );
});
it('denies an account that no longer has the destination server', async () => {
  m.guilds.mockResolvedValue([]);
  await expect(
    closeOpenReportIntakeFromWeb(
      'guild',
      form({ reportIntakeId: intakeId, confirmCloseIntake: 'on' })
    )
  ).rejects.toThrow('not available');
  expect(m.queue).not.toHaveBeenCalled();
});
