import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteBotMessage,
  exchangeDiscordCode,
  fetchDiscordUser,
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

describe('Discord GET recovery integration', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('leaves mutation and OAuth failures on their original single-attempt paths', async () => {
    vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'bot-token');
    vi.stubEnv('DISCORD_CLIENT_ID', 'test-client');
    vi.stubEnv('DISCORD_CLIENT_SECRET', 'test-secret');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{"retry_after":1}', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteBotMessage('channel-1', 'message-1')).rejects.toThrow('429');
    await expect(
      exchangeDiscordCode({ code: 'test-code', redirectUri: 'https://app.test/callback' })
    ).rejects.toThrow('429');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'POST']);
  });

  it('recovers standalone website user GETs with the same policy', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"retry_after":1}', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse({ id: 'test-user', username: 'user' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = fetchDiscordUser('access-token');
    const outcome = result.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toEqual({ value: { id: 'test-user', username: 'user' } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.cache).toBe('no-store');
  });

  it('recovers bot reads after a provider rate limit', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'bot-token');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{"retry_after":1}', { status: 429 }))
      .mockResolvedValueOnce(jsonResponse([message('1')]));
    vi.stubGlobal('fetch', fetchMock);
    const result = fetchBotChannelMessages('channel-1', 1);
    const outcome = result.then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await outcome).toEqual({ value: [message('1')] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
