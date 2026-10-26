import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ identity: vi.fn(), authority: vi.fn() }));
vi.mock('./discordApi', async (original) => ({
  ...(await original<typeof import('./discordApi')>()),
  fetchDiscordUser: state.identity,
}));
vi.mock('./application/adapters/authority', () => ({ loadFreshGuildAuthority: state.authority }));
import { loadWorkspaceAccess } from './workspaceAccess';
const session = {
  userId: 'actor',
  username: 'Moderator',
  avatarUrl: null,
  issuedAt: 0,
  expiresAt: Date.now() + 60000,
};
const token = { accessToken: 'controlled', expiresAt: Date.now() + 60000 };
const actor = {
  guildId: 'guild',
  userId: 'actor',
  present: true,
  owner: false,
  permissions: '32',
  roleIds: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.identity.mockResolvedValue({ id: 'actor' });
  state.authority.mockResolvedValue({
    kind: 'available',
    value: { guild: { id: 'guild', name: 'Selected server' }, actor },
  });
});
it.each([{ guildId: 'other' }, { userId: 'other' }, { present: false }])(
  'rejects mismatched or absent authority %j',
  async (patch) => {
    state.authority.mockResolvedValue({
      kind: 'available',
      value: { guild: { id: 'guild' }, actor: { ...actor, ...patch } },
    });
    expect(await loadWorkspaceAccess('guild', session, token)).toEqual({ kind: 'access_denied' });
  }
);
it.each([null, {}, { id: '' }])('treats malformed identity %j as unavailable', async (identity) => {
  state.identity.mockResolvedValue(identity);
  expect(await loadWorkspaceAccess('guild', session, token)).toEqual({ kind: 'unavailable' });
  expect(state.authority).not.toHaveBeenCalled();
});
it('retains local expiry requirements', async () => {
  expect(await loadWorkspaceAccess('guild', { ...session, expiresAt: 1 }, token)).toEqual({
    kind: 'authentication_required',
  });
  expect(await loadWorkspaceAccess('guild', session, { ...token, expiresAt: 1 })).toEqual({
    kind: 'authentication_required',
  });
  expect(state.identity).not.toHaveBeenCalled();
});
