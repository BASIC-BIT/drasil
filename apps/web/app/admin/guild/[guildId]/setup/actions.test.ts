import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  assertCanManageGuild: vi.fn(),
  queue: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.session,
  getCurrentDiscordToken: mocks.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.assertCanManageGuild }),
}));
vi.mock('@/lib/setupArtifactActionQueue', () => ({
  queueReportInstructionsRepairRequest: mocks.queue,
}));

import { queueReportInstructionsRepair, queueReportInstructionsRepost } from './actions';

describe('report panel setup actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({ userId: 'admin' });
    mocks.token.mockResolvedValue({ accessToken: 'token' });
    mocks.assertCanManageGuild.mockResolvedValue({ owner: true, permissions: '0' });
    mocks.queue.mockResolvedValue('queued');
  });

  it.each([false, true])('passes explicit repost=%s with the rendered panel ID', async (repost) => {
    const data = new FormData();
    data.set('reportInstructionsChannelId', 'channel');
    data.set('reportInstructionsMessageId', 'old-panel');
    await (repost ? queueReportInstructionsRepost : queueReportInstructionsRepair)('guild', data);
    expect(mocks.queue).toHaveBeenCalledWith({
      actorId: 'admin',
      channelId: 'channel',
      guildId: 'guild',
      repost,
      expectedMessageId: 'old-panel',
    });
  });

  it('retains administrator authorization for reposts', async () => {
    mocks.assertCanManageGuild.mockResolvedValue({ owner: false, permissions: '0' });
    const data = new FormData();
    data.set('reportInstructionsChannelId', 'channel');
    await expect(queueReportInstructionsRepost('guild', data)).rejects.toThrow('Administrator');
    expect(mocks.queue).not.toHaveBeenCalled();
  });
});
