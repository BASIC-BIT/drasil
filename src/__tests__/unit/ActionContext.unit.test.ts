import { createBotAuthority } from '../../application/adapters/attention';
import type { Client } from 'discord.js';
import { createDiscordActionContext } from '../../application/context';
import { createAttentionActions } from '@drasil/application';

it('creates direct correlation without a durable request and preserves source', async () => {
  const context = createDiscordActionContext({
    guildId: 'guild-1',
    userId: 'moderator-1',
    requestId: 'interaction-1',
  });
  expect(context).toEqual({
    guildId: 'guild-1',
    requestId: 'interaction-1',
    source: 'discord_interaction',
    actor: { kind: 'user', userId: 'moderator-1' },
  });
  const actions = createAttentionActions({
    authority: {
      loadFresh: async () => ({
        userId: 'moderator-1',
        guildId: 'guild-1',
        owner: false,
        present: true,
        permissions: String(1n << 40n),
        roleIds: [],
      }),
    },
    repository: {
      findById: async () => null,
      deleteById: async () => {
        throw new Error('no item');
      },
    },
    messageDeleter: {
      deleteQueueMessage: async () => {
        throw new Error('no message');
      },
    },
  });
  expect(await actions.acknowledge(context, { itemId: 'missing' })).toMatchObject({
    kind: 'outcome',
    outcome: { status: 'already_handled' },
  });
});

it('loads fresh Discord member and role facts rather than cached interaction permissions', async () => {
  const fetchMember = jest.fn(async () => ({
    id: 'moderator-1',
    permissions: { bitfield: 1n << 40n },
    roles: { cache: new Map([['role-1', {}]]) },
  }));
  const fetchRoles = jest.fn(async () => new Map());
  const fetchGuild = jest.fn(async () => ({
    id: 'guild-1',
    ownerId: 'owner-1',
    members: { fetch: fetchMember },
    roles: { fetch: fetchRoles },
  }));
  const authority = createBotAuthority({ guilds: { fetch: fetchGuild } } as unknown as Client);
  expect(await authority.loadFresh('guild-1', 'moderator-1')).toEqual({
    guildId: 'guild-1',
    userId: 'moderator-1',
    owner: false,
    present: true,
    permissions: String(1n << 40n),
    roleIds: ['role-1'],
  });
  expect(fetchGuild).toHaveBeenCalledWith({ guild: 'guild-1', force: true });
  expect(fetchMember).toHaveBeenCalledWith({ user: 'moderator-1', force: true });
  expect(fetchRoles).toHaveBeenCalledTimes(1);
});
