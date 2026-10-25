import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  session: vi.fn(),
  guild: vi.fn(),
  detail: vi.fn(),
  attentionDetail: vi.fn(),
  queue: vi.fn(),
  acknowledge: vi.fn(),
  server: vi.fn(),
  resources: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error(path), { digest: 'NEXT_REDIRECT' });
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: m.session,
  getCurrentDiscordToken: async () => ({ accessToken: 'token' }),
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: m.guild }),
}));
vi.mock('@/lib/setupDataAdapter', () => ({
  createSetupDataAdapter: () => ({ getServer: m.server }),
}));
vi.mock('@/lib/discordApi', () => ({ fetchGuildResources: m.resources }));
vi.mock('@/lib/application/adapters/authority', () => ({
  createWebAuthority: () => ({
    loadFresh: async () => ({
      userId: 'admin-1',
      guildId: 'guild-1',
      present: true,
      owner: true,
      permissions: '8',
      roleIds: [],
    }),
  }),
}));
vi.mock('@/lib/moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: () => ({ getInboxItemDetail: m.detail }),
}));
vi.mock('@/lib/moderationAttentionDataAdapter', () => ({
  createModerationAttentionDataAdapter: () => ({ getAttentionDetail: m.attentionDetail }),
}));
vi.mock('@/lib/observedAlertActionQueue', async (original) => ({
  ...(await original<typeof import('@/lib/observedAlertActionQueue')>()),
  queueObservedAlertActionRequest: m.queue,
}));
vi.mock('@/lib/queueAttentionActionAdapter', () => ({
  createQueueAttentionActionAdapter: () => ({ acknowledgeAttentionItem: m.acknowledge }),
}));
import { submitWorkspaceObservedAction, submitWorkspaceAttentionAction } from './actions';
function form(recordId = 'detection-1') {
  const data = new FormData();
  data.set('confirmAction', 'on');
  data.set('confirmedRecordId', recordId);
  data.set('confirmedTargetUserId', 'member-1');
  return data;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue({ userId: 'admin-1' });
  m.guild.mockResolvedValue({ id: 'guild-1', owner: true, permissions: '8' });
  m.detail.mockResolvedValue({
    kind: 'observed_alert',
    item: { guildId: 'guild-1', sourceId: 'detection-1', subject: { userId: 'member-1' } },
    detection: { id: 'detection-1' },
    policy: { allowedActions: ['dismiss_no_action', 'mark_false_positive', 'ban_user'] },
  });
  m.attentionDetail.mockResolvedValue({
    item: {
      guildId: 'guild-1',
      sourceId: 'queue-1',
      queueItemId: 'queue-1',
      subject: { userId: 'member-1' },
      allowedActions: ['acknowledge'],
    },
  });
  m.queue.mockResolvedValue({ id: 'request-1', status: 'queued' });
  m.acknowledge.mockResolvedValue({
    actor: { id: 'admin-1', surface: 'web' },
    itemId: 'queue-1',
    status: 'acknowledged',
  });
  m.server.mockResolvedValue({ settings: { moderator_ban_action_requires_reason: true } });
});
it.each(['dismiss_no_action', 'mark_false_positive'] as const)(
  'requires contextual confirmation for observed %s',
  async (action) => {
    const data = form();
    data.delete('confirmAction');
    expect(
      await submitWorkspaceObservedAction(
        { guildId: 'guild-1', detectionId: 'detection-1', action },
        data
      )
    ).toMatchObject({ kind: 'failed' });
    expect(m.queue).not.toHaveBeenCalled();
  }
);
it.each(['confirmedRecordId', 'confirmedTargetUserId'])(
  'rejects wrong observed %s',
  async (field) => {
    const data = form();
    data.set(field, 'wrong');
    expect(
      await submitWorkspaceObservedAction(
        { guildId: 'guild-1', detectionId: 'detection-1', action: 'dismiss_no_action' },
        data
      )
    ).toMatchObject({ kind: 'failed' });
    expect(m.queue).not.toHaveBeenCalled();
  }
);
it('uses the detection target instead of a submitted target', async () => {
  const data = form();
  data.set('targetUserId', 'attacker');
  expect(
    await submitWorkspaceObservedAction(
      { guildId: 'guild-1', detectionId: 'detection-1', action: 'dismiss_no_action' },
      data
    )
  ).toMatchObject({ kind: 'request', receipt: { id: 'request-1' } });
  expect(m.queue).toHaveBeenCalledWith(
    expect.objectContaining({ targetUserId: 'member-1', detectionEventId: 'detection-1' })
  );
});
it.each([
  null,
  {
    kind: 'observed_alert',
    item: { guildId: 'other-guild', sourceId: 'detection-1', subject: { userId: 'member-1' } },
    policy: { allowedActions: ['dismiss_no_action'] },
  },
  {
    kind: 'observed_alert',
    item: { guildId: 'guild-1', sourceId: 'detection-1', subject: { userId: 'member-1' } },
    policy: { allowedActions: [] },
  },
])('blocks unavailable, cross-guild and stale detections', async (detail) => {
  m.detail.mockResolvedValue(detail);
  expect(
    await submitWorkspaceObservedAction(
      { guildId: 'guild-1', detectionId: 'detection-1', action: 'dismiss_no_action' },
      form()
    )
  ).toMatchObject({ kind: 'failed' });
  expect(m.queue).not.toHaveBeenCalled();
});
it('retains the observed ban reason policy', async () => {
  expect(
    await submitWorkspaceObservedAction(
      { guildId: 'guild-1', detectionId: 'detection-1', action: 'ban_user' },
      form()
    )
  ).toMatchObject({ kind: 'failed', message: 'Ban reason is required.' });
  expect(m.queue).not.toHaveBeenCalled();
});
it.each(['confirmAction', 'confirmedRecordId', 'confirmedTargetUserId'])(
  'requires %s before acknowledgement',
  async (field) => {
    const data = form('queue-1');
    data.delete(field);
    expect(
      await submitWorkspaceAttentionAction({ guildId: 'guild-1', queueItemId: 'queue-1' }, data)
    ).toMatchObject({ kind: 'failed' });
    expect(m.acknowledge).not.toHaveBeenCalled();
  }
);
it('blocks stale attention and preserves structured acknowledgement', async () => {
  const data = form('queue-1');
  expect(
    await submitWorkspaceAttentionAction({ guildId: 'guild-1', queueItemId: 'queue-1' }, data)
  ).toMatchObject({ kind: 'attention', result: { status: 'acknowledged' } });
  m.acknowledge.mockClear();
  m.attentionDetail.mockResolvedValue(null);
  expect(
    await submitWorkspaceAttentionAction({ guildId: 'guild-1', queueItemId: 'queue-1' }, data)
  ).toMatchObject({ kind: 'failed' });
  expect(m.acknowledge).not.toHaveBeenCalled();
});
