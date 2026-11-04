import { createAttentionActions, type QueueAttentionItemRecord } from '@drasil/application';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitWorkspaceAttentionAction } from '../app/admin/guild/[guildId]/inbox/actions';
import { PostgresQueueAttentionActionAdapter } from './queueAttentionActionAdapter';

const runtime = vi.hoisted(() => ({ query: vi.fn(), deleteMessage: vi.fn(), roles: vi.fn() }));
vi.mock('./setupDataAdapter', async (load) => ({
  ...(await load<typeof import('./setupDataAdapter')>()),
  getPostgresPool: () => ({
    query: runtime.query,
    connect: async () => ({ query: runtime.query, release: vi.fn() }),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('authentication required');
  },
}));
vi.mock('./session', () => ({
  getCurrentAdminSession: async () => ({ userId: 'moderator-1' }),
  getCurrentDiscordToken: async () => ({ accessToken: 'token' }),
}));

vi.mock('./discordApi', async (load) => ({
  ...(await load<typeof import('./discordApi')>()),
  fetchDiscordGuild: async () => ({ id: 'guild-1', owner_id: 'owner-1' }),
  fetchDiscordGuildMember: async () => ({ user: { id: 'moderator-1' }, roles: ['moderator-role'] }),
  fetchDiscordGuildRoles: runtime.roles,
  deleteBotMessage: runtime.deleteMessage,
  fetchDiscordGuilds: async () => [{ id: 'guild-1', owner: false, permissions: String(1n << 40n) }],
}));

describe('direct web attention acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtime.roles.mockResolvedValue([{ id: 'moderator-role', permissions: String(1n << 40n) }]);
    runtime.deleteMessage.mockResolvedValue(true);
  });
  it('allows_discord_moderator_but_keeps_web_entry_gate', async () => {
    expect(
      await submitWorkspaceAttentionAction(
        { guildId: 'guild-1', queueItemId: 'item-1' },
        new FormData()
      )
    ).toMatchObject({
      kind: 'failed',
      message: 'You do not have permission to manage this guild.',
    });
    expect(runtime.query).not.toHaveBeenCalled();
  });
  it('executes directly without inserting a durable request row', async () => {
    const item: QueueAttentionItemRecord = {
      id: 'item-1',
      server_id: 'guild-1',
      item_type: 'report_thread_attention',
      queue_channel_id: 'channel-1',
      queue_message_id: 'message-1',
    };
    runtime.query.mockResolvedValue({ rows: [item] });
    const adapter = new PostgresQueueAttentionActionAdapter();
    const result = await adapter.acknowledgeAttentionItem({
      guildId: 'guild-1',
      queueItemId: 'item-1',
      actor: { id: 'moderator-1', surface: 'web' },
    });
    expect(result.status).toBe('acknowledged');
    expect(runtime.query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'select',
      'delete',
    ]);
    expect(runtime.deleteMessage).toHaveBeenCalledWith('channel-1', 'message-1');
    expect(result.actor).toEqual({ id: 'moderator-1', surface: 'web' });
  });
  it('renders execution denials instead of reporting success', async () => {
    const actions = createAttentionActions({
      authority: { loadFresh: async () => null },
      repository: {
        acknowledgeIdentityReview: async () => 'already_handled',
        findById: async () => {
          throw new Error('must authorize first');
        },
        deleteById: async () => null,
      },
      messageDeleter: { deleteQueueMessage: async () => undefined },
    });
    const adapter = new PostgresQueueAttentionActionAdapter({ attention: actions });
    await expect(
      adapter.acknowledgeAttentionItem({
        guildId: 'guild-1',
        queueItemId: 'item-1',
        actor: { id: 'moderator-1', surface: 'web' },
      })
    ).rejects.toThrow('moderation permissions');
  });
});

it('keeps web message deletion best effort and rechecks revoked role permissions', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    runtime.roles
      .mockResolvedValueOnce([{ id: 'moderator-role', permissions: '32' }])
      .mockResolvedValueOnce([{ id: 'moderator-role', permissions: '0' }]);
    runtime.query.mockResolvedValue({
      rows: [
        {
          id: 'item-1',
          server_id: 'guild-1',
          item_type: 'support_thread_attention',
          queue_channel_id: 'channel-1',
          queue_message_id: 'message-1',
        },
      ],
    });
    runtime.deleteMessage.mockRejectedValueOnce(new Error('message deletion unavailable'));
    const adapter = new PostgresQueueAttentionActionAdapter();
    const input = {
      guildId: 'guild-1',
      queueItemId: 'item-1',
      actor: { id: 'moderator-1', surface: 'web' },
    };
    expect((await adapter.acknowledgeAttentionItem(input)).status).toBe('acknowledged');
    runtime.query.mockClear();
    await expect(adapter.acknowledgeAttentionItem(input)).rejects.toThrow('moderation permissions');
    expect(runtime.query).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});

it('acknowledges identity review through the web transaction without deleting its notification', async () => {
  runtime.query.mockReset();
  runtime.deleteMessage.mockClear();
  runtime.roles.mockResolvedValue([{ id: 'moderator-role', permissions: String(1n << 40n) }]);
  const item = {
    id: 'item',
    server_id: 'guild-1',
    item_type: 'report_thread_attention',
    report_intake_id: 'intake',
    queue_channel_id: 'channel',
    queue_message_id: 'message',
    metadata: { identity_review: { revision: 2 } },
  };
  const metadata = {
    retained: 'evidence',
    analysis: {
      handoff: {
        state: 'pending',
        reason: 'no_match',
        attempts: 0,
        nextDueAt: new Date().toISOString(),
        receipt: 'pending',
      },
    },
  };
  runtime.query.mockImplementation(async (sql: string) => {
    if (sql.includes('from moderation_queue_items')) return { rows: [item] };
    if (sql.includes('from report_intakes')) return { rows: [{ id: 'intake', metadata }] };
    if (sql.includes('update moderation_queue_items')) return { rows: [{ id: 'item' }] };
    return { rows: [] };
  });
  const result = await new PostgresQueueAttentionActionAdapter().acknowledgeAttentionItem({
    guildId: 'guild-1',
    queueItemId: 'item',
    actor: { id: 'moderator-1', surface: 'web' },
  });
  expect(result.status).toBe('acknowledged');
  const write = runtime.query.mock.calls.find(([sql]) =>
    String(sql).includes('update report_intakes')
  );
  expect(JSON.parse(write![1][1])).toMatchObject({
    retained: 'evidence',
    analysis: {
      handoff: {
        state: 'acknowledged',
        acknowledgedBy: 'moderator-1',
        acknowledgedAt: expect.any(String),
      },
    },
  });
  expect(runtime.deleteMessage).not.toHaveBeenCalled();
  expect(runtime.query.mock.calls.some(([sql]) => String(sql).startsWith('delete'))).toBe(false);
  expect(runtime.query).toHaveBeenCalledWith('commit');
});
