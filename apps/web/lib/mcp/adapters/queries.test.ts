import { afterEach, it, expect, vi } from 'vitest';
import { createMcpQueries } from '../queries';
import { createPostgresQueryRepository, readDiscordMessages } from './queries';
import { accessFixture, guildId, principal } from '../queryTestFixtures';
import { createDiscordContentAuthorizer } from './visibility';
import {
  fetchDiscordChannel,
  fetchDiscordThreadMember,
  fetchBotMessagePage,
} from '../../discordApi';
import { toMcpQueryResult } from '../results';
const channelId = '200000000000000001';
const messageId = (n: number) => String(300000000000000000n - BigInt(n));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it('uses narrow fresh Discord paths, no caller URL, and keeps credentials out of content', async () => {
  vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'test-bot-token');
  vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test/api/v10');
  const dataset = Array.from({ length: 12 }, (_, n) => ({
    id: messageId(n),
    channel_id: channelId,
    timestamp: '2026-01-01T00:00:00Z',
    author: { id: principal.userId, username: 'name' },
    content: '\\😀'.repeat(2000),
    attachments: Array.from({ length: 13 }, (_, i) => ({
      id: String(i),
      filename: 'file',
      size: 10,
      content_type: 'text/plain',
      url: 'https://credential.example/signed',
      proxy_url: 'https://credential.example/proxy',
    })),
  }));
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    expect(options.cache).toBe('no-store');
    expect(options.headers).toEqual({ authorization: 'Bot test-bot-token' });
    const parsed = new URL(url);
    fetched.push(parsed.pathname);
    if (parsed.pathname.endsWith('/thread-members/' + principal.userId))
      return Response.json({ id: channelId, user_id: principal.userId });
    if (!parsed.pathname.endsWith('/messages'))
      return Response.json({
        id: channelId,
        guild_id: guildId,
        type: 0,
        name: 'Channel',
        permission_overwrites: [],
      });
    const before = parsed.searchParams.get('before');
    const start = before ? dataset.findIndex((message) => message.id === before) + 1 : 0;
    return Response.json(dataset.slice(start, start + Number(parsed.searchParams.get('limit'))));
  });
  expect((await fetchDiscordChannel(channelId)).id).toBe(channelId);
  expect((await fetchDiscordThreadMember(channelId, principal.userId)).user_id).toBe(
    principal.userId
  );
  await expect(fetchBotMessagePage('https://external.example', 25, null)).rejects.toThrow(
    'Invalid Discord ID'
  );
  const { access } = accessFixture();
  const binding = await access.authorizeRead(principal, { kind: 'cases', guildId });
  const queries = createMcpQueries({
    access,
    repository: createPostgresQueryRepository(),
    cursorSecret: 'test-cursor-secret-at-least-32-characters',
    authorizeDiscordContent: async () => binding,
    messages: readDiscordMessages,
  });
  const seen = [];
  let cursor: string | undefined;
  do {
    const result = await queries.execute(principal, {
      kind: 'get_message_context',
      guildId,
      channelId,
      cursor,
    });
    if (result.kind !== 'allowed') throw new Error('expected message page');
    expect(Buffer.byteLength(JSON.stringify(toMcpQueryResult(result)))).toBeLessThanOrEqual(65536);
    expect(JSON.stringify(result)).not.toContain('credential.example');
    expect(JSON.stringify(result)).not.toContain('test-bot-token');
    expect(
      result.items.reduce((total, item) => total + (item.attachments as unknown[]).length, 0)
    ).toBeLessThanOrEqual(10);
    for (const item of result.items) {
      expect((item.attachments as unknown[]).length).toBeLessThanOrEqual(10);
      expect(String(item.content).length).toBeLessThanOrEqual(4000);
      seen.push(item.id);
    }
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  expect(seen).toEqual(dataset.map((message) => message.id));
  expect(fetched.every((path) => path.startsWith('/api/v10/channels/' + channelId))).toBe(true);
});
it('denies raw reads when messages disappear after visibility or a response belongs to another channel', async () => {
  const { access } = accessFixture();
  const binding = await access.authorizeRead(principal, { kind: 'cases', guildId });
  const queries = createMcpQueries({
    access,
    repository: createPostgresQueryRepository(),
    cursorSecret: 'test-cursor-secret-at-least-32-characters',
    authorizeDiscordContent: async () => binding,
    messages: readDiscordMessages,
  });
  vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'test-bot-token');
  vi.stubGlobal('fetch', async () => new Response('sensitive provider error', { status: 403 }));
  expect(
    await queries.execute(principal, {
      kind: 'get_message_context',
      guildId,
      channelId,
      messageId: messageId(0),
    })
  ).toEqual({ kind: 'denied', reason: 'unavailable' });
  vi.stubGlobal('fetch', async () =>
    Response.json([
      {
        id: messageId(0),
        channel_id: 'other',
        author: { id: principal.userId, username: 'name' },
        timestamp: 'time',
        content: 'hidden',
      },
    ])
  );
  expect(
    await queries.execute(principal, { kind: 'get_message_context', guildId, channelId })
  ).toEqual({ kind: 'denied', reason: 'unavailable' });
});
it('never sends a bot content request when fresh actor access is absent', async () => {
  const { access, state } = accessFixture();
  state.present = false;
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const queries = createMcpQueries({
    access,
    repository: createPostgresQueryRepository(),
    cursorSecret: 'test-cursor-secret-at-least-32-characters',
    authorizeDiscordContent: createDiscordContentAuthorizer(access),
    messages: readDiscordMessages,
  });
  expect(
    await queries.execute(principal, { kind: 'get_message_context', guildId, channelId })
  ).toMatchObject({ kind: 'denied' });
  expect(fetch).not.toHaveBeenCalled();
});
