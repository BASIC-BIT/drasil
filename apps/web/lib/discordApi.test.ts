import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteBotMessage,
  fetchBotChannelMessages,
  fetchDiscordGuilds,
  type DiscordGuildSummary,
  type DiscordMessage,
} from './discordApi';

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

function message(id: string): DiscordMessage {
  return {
    id,
    channel_id: 'channel-1',
    content: `message ${id}`,
    timestamp: '2026-06-01T00:00:00.000Z',
    author: { id: 'user-1', username: 'user-1' },
    attachments: [],
  };
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

  it('paginates bot channel messages and returns oldest first', async () => {
    vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test/api/v10');
    vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'bot-token');
    const firstPage = Array.from({ length: 100 }, (_, index) => message(String(200 - index)));
    const secondPage = [message('100'), message('99')];
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(firstPage))
      .mockResolvedValueOnce(jsonResponse(secondPage));
    vi.stubGlobal('fetch', fetchMock);

    const messages = await fetchBotChannelMessages('channel-1', 102);

    expect(messages.map((item) => item.id)).toEqual([
      '99',
      '100',
      ...firstPage.map((item) => item.id).reverse(),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/channels/channel-1/messages?limit=100'
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('before=101');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: { authorization: 'Bot bot-token' },
      })
    );
  });

  it('deletes bot messages and treats missing messages as already gone', async () => {
    vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test/api/v10');
    vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'bot-token');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteBotMessage('channel-1', 'message-1')).resolves.toBe(true);
    await expect(deleteBotMessage('channel-1', 'missing-message')).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://discord.test/api/v10/channels/channel-1/messages/message-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: { authorization: 'Bot bot-token' },
      })
    );
  });
});
