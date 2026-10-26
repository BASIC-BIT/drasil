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
  getPostgresPool: () => ({ query: m.queue }),
}));
vi.mock('@/lib/reportIntakePortalDataAdapter', () => ({ loadReporterOpenIntake: m.openIntake }));

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
  m.queue.mockResolvedValue({ rows: [{ id: 'request', status: 'queued' }] });
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
  const values = m.queue.mock.calls[1][1];
  expect(values.slice(0, 5)).toEqual([
    'guild',
    'submit_user_report',
    'reporter',
    'web_report',
    '123456789012345678',
  ]);
  expect(JSON.parse(values[10])).toEqual({
    report_action: 'submit_user_report',
    requested_surface: 'web_report',
    reason: 'evidence',
    target_label: '123456789012345678',
  });
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
  const values = m.queue.mock.calls[0][1];
  expect(values.slice(0, 5)).toEqual([
    'guild',
    'start_report_intake',
    'reporter',
    'web_report',
    null,
  ]);
  expect(JSON.parse(values[10])).toEqual({
    channel_id: 'channel',
    report_action: 'start_report_intake',
    requested_surface: 'web_report',
  });
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
