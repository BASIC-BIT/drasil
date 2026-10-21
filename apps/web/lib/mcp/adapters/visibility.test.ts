import { it, expect } from 'vitest';
import {
  createDiscordContentAuthorizer,
  createWorkflowContentAuthorizer,
  type VisibilityApi,
} from './visibility';
import { DISCORD_PERMISSIONS as P } from '../../discordPermissions';
import { accessFixture, guildId, principal } from '../queryTestFixtures';
import type { DiscordChannel } from '../../discordApi';
const channelId = '200000000000000001';
const parentId = '200000000000000002';
const botId = '200000000000000003';
function harness() {
  const { access, state: authorityState, grant } = accessFixture();
  const state = {
    permissions: P.ViewChannel | P.ReadMessageHistory,
    botPermissions: P.ViewChannel | P.ReadMessageHistory,
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
      if (!state.members.has(userId)) throw new Error('404');
      return { id, user_id: userId };
    },
  };
  return {
    state,
    api,
    authorityState,
    grant,
    access,
    workflow: createWorkflowContentAuthorizer(access, api),
    read: createDiscordContentAuthorizer(access, api),
  };
}
it('refreshes effective overwrites on every request, including role and member precedence', async () => {
  const h = harness();
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'allowed' });
  h.state.channel = {
    ...h.state.channel,
    permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) }],
  };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
  h.state.channel = {
    ...h.state.channel,
    permission_overwrites: [
      { id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) },
      { id: 'actor-role', type: 0, allow: String(P.ViewChannel), deny: '0' },
      { id: 'bot-role', type: 0, allow: String(P.ViewChannel), deny: '0' },
    ],
  };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'allowed' });
  h.state.channel = {
    ...h.state.channel,
    permission_overwrites: [
      ...h.state.channel.permission_overwrites!,
      { id: principal.userId, type: 1, allow: '0', deny: String(P.ReadMessageHistory) },
    ],
  };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
});
it('requires independent actor and bot private-thread membership', async () => {
  const h = harness();
  h.state.channel = {
    ...h.state.channel,
    type: 12,
    parent_id: parentId,
    permission_overwrites: undefined,
  };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'allowed' });
  h.state.members.delete(principal.userId);
  const readHiddenThread = () => h.read(principal, guildId, channelId);
  expect(await readHiddenThread()).toMatchObject({ kind: 'denied' });
  h.state.members.add(principal.userId);
  h.state.members.delete(botId);
  expect(await readHiddenThread()).toMatchObject({ kind: 'denied' });
});
it.each([P.ManageThreads, P.Administrator])(
  'permits privileged private-thread access only with effective visibility (%s)',
  async (permission) => {
    const h = harness();
    h.state.channel = { ...h.state.channel, type: 12, parent_id: parentId };
    h.state.members.clear();
    h.state.permissions |= permission;
    h.state.botPermissions |= permission;
    expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'allowed' });
    h.state.parent = {
      ...h.state.parent,
      permission_overwrites: [
        { id: principal.userId, type: 1, allow: '0', deny: String(P.ViewChannel) },
      ],
    };
    expect(await h.read(principal, guildId, channelId)).toMatchObject({
      kind: permission === P.Administrator ? 'allowed' : 'denied',
    });
  }
);
it('recognizes guild owner but still requires the bot to see the channel', async () => {
  const h = harness();
  h.state.ownerId = principal.userId;
  h.state.permissions = 0n;
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'allowed' });
  h.state.botPermissions = 0n;
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
});
it('denies unknown channels, parents, guild bindings and incomplete permissions', async () => {
  const h = harness();
  h.state.channel = { ...h.state.channel, guild_id: 'other' };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
  h.state.channel = { ...h.state.channel, guild_id: guildId, permission_overwrites: undefined };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
  h.state.channel = { ...h.state.channel, type: 11, parent_id: parentId };
  h.state.parent = { ...h.state.parent, guild_id: 'other' };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
  h.api.channel = async () => {
    throw new Error('missing');
  };
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
});
it('does not trust mismatched membership lookup results', async () => {
  const h = harness();
  h.state.channel = { ...h.state.channel, type: 12, parent_id: parentId };
  h.api.threadMember = async (id) => ({ id, user_id: 'other' });
  expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
});

it.each([
  ['ban_user', P.BanMembers],
  ['kick_user', P.KickMembers],
] as const)(
  'allows exact %s message context without granting case reads',
  async (workflowId, permission) => {
    const h = harness();
    h.authorityState.permissions = String(permission);
    h.authorityState.owner = false;
    h.grant.scopes = ['drasil:read', 'drasil:moderate'];
    const actor = { ...principal, scopes: h.grant.scopes };
    expect(await h.workflow(actor, guildId, channelId, workflowId)).toMatchObject({
      kind: 'allowed',
    });
    expect(await h.read(principal, guildId, channelId)).toMatchObject({ kind: 'denied' });
    h.state.botPermissions = P.ViewChannel;
    expect(await h.workflow(actor, guildId, channelId, workflowId)).toMatchObject({
      kind: 'denied',
    });
  }
);

it('refreshes workflow scope, role, actor overwrites and private-thread membership', async () => {
  const h = harness();
  h.grant.scopes = ['drasil:read', 'drasil:moderate'];
  h.authorityState.owner = false;
  h.authorityState.permissions = String(P.BanMembers);
  const actor = { ...principal, scopes: h.grant.scopes };
  const read = () => h.workflow(actor, guildId, channelId, 'ban_user');
  expect(await read()).toMatchObject({ kind: 'allowed' });
  expect(await h.workflow(principal, guildId, channelId, 'ban_user')).toMatchObject({
    kind: 'denied',
  });
  h.authorityState.permissions = String(P.KickMembers);
  expect(await read()).toMatchObject({ kind: 'denied' });
  h.authorityState.permissions = String(P.BanMembers);
  h.state.channel = { ...h.state.channel, type: 12, parent_id: parentId };
  expect(await read()).toMatchObject({ kind: 'allowed' });
  h.state.members.delete(principal.userId);
  expect(await read()).toMatchObject({ kind: 'denied' });
  h.state.members.add(principal.userId);
  h.state.members.delete(botId);
  expect(await read()).toMatchObject({ kind: 'denied' });
  h.state.members.add(botId);
  h.state.parent = {
    ...h.state.parent,
    permission_overwrites: [
      { id: principal.userId, type: 1, allow: '0', deny: String(P.ViewChannel) },
    ],
  };
  expect(await read()).toMatchObject({ kind: 'denied' });
  h.state.parent = { ...h.state.parent, permission_overwrites: [] };
  h.grant.scopes = ['drasil:moderate'];
  expect(await read()).toMatchObject({ kind: 'denied' });
});
