import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDiscordGuilds, type DiscordGuildSummary } from './discordApi';

function guild(id: string): DiscordGuildSummary {
  return {
    id,
    name: `Guild ${id}`,
    icon: null,
    owner: false,
    permissions: '0',
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

describe('Discord API helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('paginates current user guilds', async () => {
    vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test/api/v10');
    const firstPage = Array.from({ length: 200 }, (_, index) => guild(String(index + 1)));
    const secondPage = [guild('201')];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDiscordGuilds('access-token')).resolves.toHaveLength(201);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=200');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('after=200');
  });
});
