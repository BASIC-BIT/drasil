import { beforeEach, expect, it, vi } from 'vitest';
import { ReadDependencyUnavailableError } from '@drasil/application';
const state = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  identity: vi.fn(),
  directory: vi.fn(),
  guild: vi.fn(),
  member: vi.fn(),
  roles: vi.fn(),
  adapter: vi.fn(),
}));
vi.mock('./session', () => ({
  getCurrentAdminSession: state.session,
  getCurrentDiscordToken: state.token,
}));
vi.mock('./discordApi', async (original) => ({
  ...(await original<typeof import('./discordApi')>()),
  fetchDiscordUser: state.identity,
  fetchDiscordGuilds: state.directory,
  fetchDiscordGuild: state.guild,
  fetchDiscordGuildMember: state.member,
  fetchDiscordGuildRoles: state.roles,
}));
vi.mock('./moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: state.adapter,
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error('not_found');
  },
}));
import { DiscordApiError } from './discordApi';
import { loadWorkspaceRoute } from './workspaceRouteData';
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  state.session.mockResolvedValue({ userId: 'admin', expiresAt: Date.now() + 60000 });
  state.token.mockResolvedValue({ accessToken: 'token', expiresAt: Date.now() + 60000 });
  state.identity.mockResolvedValue({ id: 'admin' });
  state.directory.mockRejectedValue(new ReadDependencyUnavailableError({}));
  state.guild.mockResolvedValue({ id: 'guild', owner_id: 'admin', name: 'Selected server' });
  state.member.mockResolvedValue({ user: { id: 'admin' }, roles: [] });
  state.roles.mockResolvedValue([{ id: 'guild', permissions: '0' }]);
});
it('reads selected metadata without the directory dependency', async () => {
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).resolves.toMatchObject({
    kind: 'ready',
    guild: { id: 'guild', name: 'Selected server' },
  });
  expect(state.directory).not.toHaveBeenCalled();
  expect(state.adapter).toHaveBeenCalledTimes(1);
});
it('returns explicit denied state before constructing any adapter', async () => {
  state.member.mockRejectedValue(new DiscordApiError(404, 'private'));
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).resolves.toEqual({
    kind: 'access_denied',
  });
  expect(state.adapter).not.toHaveBeenCalled();
});
it('returns explicit unavailable state before constructing any adapter', async () => {
  state.roles.mockRejectedValue(new ReadDependencyUnavailableError({}));
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).resolves.toMatchObject({
    kind: 'unavailable',
  });
  expect(state.adapter).not.toHaveBeenCalled();
});
it('redirects revoked OAuth outside dependency catches and retains returnTo', async () => {
  state.identity.mockRejectedValue(new DiscordApiError(401, 'private'));
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).rejects.toThrow(
    'redirect:/api/auth/discord?returnTo=%2Fadmin%2Fguild%2Fguild%2Finbox'
  );
  expect(state.adapter).not.toHaveBeenCalled();
});
it('keeps unexpected failures distinct for the route error boundary', async () => {
  state.roles.mockRejectedValue(new Error('unexpected bug'));
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).rejects.toThrow(
    'Unable to verify workspace access.'
  );
  expect(state.adapter).not.toHaveBeenCalled();
});
