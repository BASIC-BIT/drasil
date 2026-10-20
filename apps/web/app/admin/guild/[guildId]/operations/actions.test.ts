import { beforeEach, expect, test, vi } from 'vitest';
const m = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  guild: vi.fn(),
  queue: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: m.session,
  getCurrentDiscordToken: m.token,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: m.guild }),
}));
vi.mock('@/lib/moderationQueueOperationActionQueue', () => ({
  queueModerationQueueOperation: m.queue,
}));
import { queueModerationQueueOperationAction } from './actions';
import type { ModerationQueueOperationAction } from '@/lib/moderationQueueOperationActionQueue';
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ userId: 'admin' });
  m.token.mockResolvedValue({ accessToken: 'token' });
  m.guild.mockResolvedValue({ owner: false, permissions: '8' });
  m.queue.mockResolvedValue('queued');
});
const confirmed: readonly [ModerationQueueOperationAction, string][] = [
  ['clear_moderation_queue', 'confirmClearQueue'],
  ['close_resolved_case_threads', 'confirmCloseResolvedThreads'],
  ['apply_case_role_lockdown', 'confirmApplyLockdown'],
  ['intake_role_members', 'confirmRoleIntake'],
];
test.each(confirmed)(
  'authenticated %s execution needs its actual confirmation flag',
  async (kind, flag) => {
    const form = new FormData();
    form.set('execute', 'true');
    form.set('roleId', 'role');
    await expect(queueModerationQueueOperationAction('guild', kind, form)).rejects.toThrow(
      'Confirm'
    );
    expect(m.queue).not.toHaveBeenCalled();
    form.set(flag, 'on');
    await queueModerationQueueOperationAction('guild', kind, form);
    expect(m.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'admin',
        guildId: 'guild',
        command: expect.objectContaining({ kind }),
      })
    );
  }
);
test('locks apply unsync to the submitted checkbox and uses the authenticated actor', async () => {
  const form = new FormData();
  form.set('confirmApplyLockdown', 'on');
  form.set('actorId', 'forged');
  await queueModerationQueueOperationAction('guild', 'apply_case_role_lockdown', form);
  expect(m.queue).toHaveBeenCalledWith({
    actorId: 'admin',
    guildId: 'guild',
    command: { kind: 'apply_case_role_lockdown', unsyncAllowedChannels: false },
  });
});
test('role preview needs no execution confirmation and keeps reason and bounded selection', async () => {
  const form = new FormData();
  form.set('roleId', 'role');
  form.set('limit', '9999');
  form.set('reason', ' reason ');
  await queueModerationQueueOperationAction('guild', 'intake_role_members', form);
  expect(m.queue).toHaveBeenCalledWith({
    actorId: 'admin',
    guildId: 'guild',
    command: {
      kind: 'intake_role_members',
      execute: false,
      limit: 250,
      reason: 'reason',
      roleId: 'role',
    },
  });
});
test('Manage Server alone cannot admit administrator web operations', async () => {
  m.guild.mockResolvedValue({ owner: false, permissions: '32' });
  await expect(
    queueModerationQueueOperationAction('guild', 'sync_moderation_queue')
  ).rejects.toThrow('Administrator');
  expect(m.queue).not.toHaveBeenCalled();
});
test('missing authenticated session cannot admit operations', async () => {
  m.session.mockResolvedValue(null);
  await expect(
    queueModerationQueueOperationAction('guild', 'sync_moderation_queue')
  ).rejects.toThrow('redirect:');
  expect(m.queue).not.toHaveBeenCalled();
});
