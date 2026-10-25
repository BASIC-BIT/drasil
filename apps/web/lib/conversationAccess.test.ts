import { expect, it } from 'vitest';
import { assertConversationAccess, type VisibilityApi } from './conversationAccess';
import { DISCORD_PERMISSIONS as P } from './discordPermissions';
import { DiscordApiError, type DiscordChannel } from './discordApi';
const guildId = '100000000000000001';
const principal = { userId: '100000000000000002' };
const channelId = '200000000000000001';
const parentId = '200000000000000002';
const botId = '200000000000000003';
function harness() {
  const state = {
    permissions: P.ManageGuild | P.ViewChannel | P.ReadMessageHistory,
    botPermissions: P.ManageGuild | P.ViewChannel | P.ReadMessageHistory,
    ownerId: 'owner',
    channel: {
      id: channelId,
      guild_id: guildId,
      name: 'channel',
      type: 0,
      permission_overwrites: [],
    } as DiscordChannel,
    parent: {
      id: parentId,
      guild_id: guildId,
      name: 'parent',
      type: 0,
      permission_overwrites: [],
    } as DiscordChannel,
    members: new Set([principal.userId, botId]),
  };
  const api: VisibilityApi = {
    guild: async () => ({ id: guildId, owner_id: state.ownerId }),
    roles: async () => [
      { id: guildId, name: 'everyone', permissions: '0', position: 0, managed: false },
      {
        id: 'actor-role',
        name: 'actor',
        permissions: String(state.permissions),
        position: 1,
        managed: false,
      },
      {
        id: 'bot-role',
        name: 'bot',
        permissions: String(state.botPermissions),
        position: 2,
        managed: false,
      },
    ],
    member: async (_guildId, userId) => ({
      user: { id: userId, username: 'name' },
      roles: [userId === botId ? 'bot-role' : 'actor-role'],
    }),
    bot: async () => ({ id: botId, username: 'bot' }),
    channel: async (id) => (id === channelId ? state.channel : state.parent),
    threadMember: async (id, userId) => {
      if (!state.members.has(userId)) throw new DiscordApiError(404, 'missing membership');
      return { id, user_id: userId };
    },
  };
  return {
    state,
    api,
    read: () => assertConversationAccess({ guildId, actorId: principal.userId, channelId }, api),
  };
}

it('requires current moderator guild eligibility independently of channel visibility', async () => {
  const h = harness();
  h.state.permissions = P.ViewChannel | P.ReadMessageHistory;
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
it('denies a guild manager without effective channel history', async () => {
  const h = harness();
  h.state.channel = {
    ...h.state.channel,
    permission_overwrites: [
      { id: principal.userId, type: 1, allow: '0', deny: String(P.ReadMessageHistory) },
    ],
  };
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
it('requires actor and bot private thread memberships', async () => {
  const h = harness();
  h.state.channel = { ...h.state.channel, type: 12, parent_id: parentId };
  await expect(h.read()).resolves.toBeUndefined();
  h.state.members.delete(principal.userId);
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
  h.state.members.add(principal.userId);
  h.state.members.delete(botId);
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
it.each([P.Administrator, P.ManageGuild | P.ViewChannel | P.ReadMessageHistory | P.ManageThreads])(
  'honors private thread privileges %s',
  async (permissions) => {
    const h = harness();
    h.state.permissions = permissions;
    h.state.botPermissions = P.Administrator;
    h.state.members.clear();
    h.state.channel = { ...h.state.channel, type: 12, parent_id: parentId };
    await expect(h.read()).resolves.toBeUndefined();
  }
);
it('honors owner access but still requires bot access', async () => {
  const h = harness();
  h.state.ownerId = principal.userId;
  h.state.permissions = 0n;
  await expect(h.read()).resolves.toBeUndefined();
  h.state.botPermissions = 0n;
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
it('fails closed on cross-guild and missing channel metadata', async () => {
  const h = harness();
  h.state.channel = { ...h.state.channel, guild_id: 'other' };
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
  h.state.channel = { ...h.state.channel, guild_id: guildId, permission_overwrites: undefined };
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
it('bounds upstream failures without forwarding private detail', async () => {
  const h = harness();
  h.api.channel = async () => {
    throw new DiscordApiError(503, 'PRIVATE');
  };
  await expect(h.read()).rejects.toMatchObject({
    reason: 'upstream',
    message: 'Conversation unavailable.',
  });
});
it('fails closed when channel type or guild ownership metadata is missing', async () => {
  const h = harness();
  h.state.channel = { ...h.state.channel, type: undefined as unknown as number };
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
  h.state.channel = { ...h.state.channel, type: 0 };
  h.api.guild = async () => ({ id: guildId, owner_id: undefined as unknown as string });
  await expect(h.read()).rejects.toMatchObject({ reason: 'denied' });
});
