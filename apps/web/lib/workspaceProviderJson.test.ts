import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({
  session: vi.fn(),
  token: vi.fn(),
  adapter: vi.fn(),
  detail: vi.fn(),
}));
vi.mock('./session', () => ({
  getCurrentAdminSession: state.session,
  getCurrentDiscordToken: state.token,
}));
vi.mock('./moderationWorkspaceDataAdapter', () => ({
  createModerationWorkspaceDataAdapter: state.adapter,
}));
vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('Unexpected redirect');
  },
}));
import { loadWorkspaceRoute } from './workspaceRouteData';
import { GET } from '../app/api/admin/guild/[guildId]/inbox/[itemId]/route';

const request = () =>
  GET(new NextRequest('https://drasil.example/api/admin/guild/guild/inbox/case:case'), {
    params: Promise.resolve({ guildId: 'guild', itemId: 'case:case' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test');
  vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'controlled-bot-token');
  state.session.mockResolvedValue({
    userId: 'actor',
    username: 'Moderator',
    avatarUrl: null,
    issuedAt: 0,
    expiresAt: Date.now() + 60000,
  });
  state.token.mockResolvedValue({
    accessToken: 'controlled-actor-token',
    expiresAt: Date.now() + 60000,
  });
  state.adapter.mockReturnValue({ getInboxItemDetail: state.detail });
  state.detail.mockResolvedValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each(['identity', 'roles'] as const)(
  'HTTP200 malformed %s JSON is unavailable before any adapter and recovers through the real decoder',
  async (source) => {
    let malformed = true;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (malformed && path === (source === 'identity' ? '/users/@me' : '/guilds/guild/roles'))
          return new Response('{"PRIVATE_PROVIDER_SENTINEL":', {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        if (path === '/users/@me') return Response.json({ id: 'actor', username: 'Moderator' });
        if (path === '/guilds/guild')
          return Response.json({ id: 'guild', name: 'Selected server', owner_id: 'owner' });
        if (path === '/guilds/guild/members/actor')
          return Response.json({ user: { id: 'actor' }, roles: [] });
        if (path === '/guilds/guild/roles')
          return Response.json([{ id: 'guild', permissions: '32' }]);
        throw new Error('Unexpected provider path');
      })
    );

    await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).resolves.toEqual({
      kind: 'unavailable',
    });
    const failure = await request();
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ code: 'unavailable' });
    expect(failure.headers.get('Cache-Control')).toBe('private, no-store');
    expect(failure.headers.get('Retry-After')).toBeNull();
    expect(state.adapter).not.toHaveBeenCalled();
    expect(state.detail).not.toHaveBeenCalled();
    if (source === 'identity') expect(calls).toEqual(['/users/@me', '/users/@me']);
    expect(calls).not.toContain('/users/@me/guilds');
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(
      'PRIVATE_PROVIDER_SENTINEL'
    );

    malformed = false;
    await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).resolves.toMatchObject({
      kind: 'ready',
    });
    const recovered = await request();
    expect(recovered.status).toBe(404);
    expect(await recovered.json()).toEqual({ code: 'not_found' });
    expect(state.adapter).toHaveBeenCalledTimes(2);
    expect(state.detail).toHaveBeenCalledExactlyOnceWith({ guildId: 'guild', itemId: 'case:case' });
  }
);

it('keeps a SyntaxError outside provider JSON decoding as a sanitized unexpected failure', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockRejectedValue(new SyntaxError('PRIVATE_PROGRAMMING_BUG'))
  );
  await expect(loadWorkspaceRoute('guild', '/admin/guild/guild/inbox')).rejects.toThrow(
    'Unable to verify workspace access.'
  );
  const response = await request();
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ code: 'internal_error' });
  expect(state.adapter).not.toHaveBeenCalled();
  expect(state.detail).not.toHaveBeenCalled();
});
