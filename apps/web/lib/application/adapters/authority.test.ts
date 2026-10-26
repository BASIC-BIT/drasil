import { beforeEach, expect, it, vi } from 'vitest';
import { ReadDependencyUnavailableError } from '@drasil/application';
const discord = vi.hoisted(() => ({ guild: vi.fn(), member: vi.fn(), roles: vi.fn() }));
vi.mock('../../discordApi', async (original) => ({
  ...(await original<typeof import('../../discordApi')>()),
  fetchDiscordGuild: discord.guild,
  fetchDiscordGuildMember: discord.member,
  fetchDiscordGuildRoles: discord.roles,
}));
import { DiscordApiError } from '../../discordApi';
import { createWebAuthority } from './authority';
beforeEach(() => {
  vi.resetAllMocks();
  discord.guild.mockResolvedValue({ id: 'guild', owner_id: 'owner', name: 'Selected server' });
  discord.member.mockResolvedValue({ user: { id: 'actor' }, roles: ['manager'] });
  discord.roles.mockResolvedValue([
    { id: 'guild', permissions: '0' },
    { id: 'manager', permissions: '32' },
  ]);
});
it('projects the shared fresh facts with current roles and permissions', async () => {
  expect(await createWebAuthority().loadFresh('guild', 'actor')).toEqual({
    guildId: 'guild',
    userId: 'actor',
    owner: false,
    present: true,
    roleIds: ['manager'],
    permissions: '32',
  });
});
it('does not relabel a returned member as the requested user', async () => {
  discord.member.mockResolvedValue({ user: { id: 'someone-else' }, roles: ['manager'] });
  expect(await createWebAuthority().loadFresh('guild', 'actor')).toMatchObject({
    userId: 'someone-else',
  });
});
it.each(['guild', 'member', 'roles'] as const)(
  'retains null projection for missing %s',
  async (source) => {
    discord[source].mockRejectedValue(new DiscordApiError(404, 'private'));
    expect(await createWebAuthority().loadFresh('guild', 'actor')).toBeNull();
  }
);
it('preserves dependency exceptions for application and MCP consumers', async () => {
  const error = new ReadDependencyUnavailableError({});
  discord.roles.mockRejectedValue(error);
  await expect(createWebAuthority().loadFresh('guild', 'actor')).rejects.toBe(error);
});
it('waits for all fresh facts and consistently prefers outage over missing member', async () => {
  discord.member.mockRejectedValue(new DiscordApiError(404, 'private'));
  discord.roles.mockRejectedValue(new ReadDependencyUnavailableError({}));
  await expect(createWebAuthority().loadFresh('guild', 'actor')).rejects.toBeInstanceOf(
    ReadDependencyUnavailableError
  );
});

import { loadFreshGuildAuthority } from './authority';
it.each(['guild', 'member', 'roles'] as const)('tags the missing %s endpoint', async (source) => {
  discord[source].mockRejectedValue(new DiscordApiError(404, 'private'));
  expect(await loadFreshGuildAuthority('guild', 'actor')).toEqual({ kind: 'missing', source });
});
it.each(['guild', 'member', 'roles'] as const)(
  'rejects malformed %s responses as unavailable',
  async (source) => {
    discord[source].mockResolvedValue({ private: 'provider body' });
    await expect(loadFreshGuildAuthority('guild', 'actor')).rejects.toBeInstanceOf(
      ReadDependencyUnavailableError
    );
  }
);
