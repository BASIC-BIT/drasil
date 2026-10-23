import { vi } from 'vitest';
import type { ConnectionGrant } from '@drasil/application';
import { createWebAuthority } from '../application/adapters/authority';
import { currentReadRequestContext } from '../readRequestContext';
import { createWebDelegatedAccess } from './access';
import { readDiscordMessages } from './adapters/queries';
import { createDiscordContentAuthorizer } from './adapters/visibility';
import { createMcpQueries, type QueryRepository } from './queries';
import { guildId, principal } from './queryTestFixtures';

export const channelId = '100000000000000003';
const staffRoleId = '100000000000000004';
const botId = '100000000000000005';
const botRoleId = '100000000000000006';
export const messageId = '100000000000000007';

/** Only HTTP and persistence boundaries are controlled. Authority and visibility stay real. */
export function readReliabilityFixture() {
  const state = { staff: true, visible: true };
  const grant: { -readonly [K in keyof ConnectionGrant]: ConnectionGrant[K] } = {
    ...principal,
    version: 1,
    selection: { mode: 'all_eligible' },
    createdAt: new Date(),
    revokedAt: null,
  };
  const failures = new Map<string, { path: string; remaining: number; delaySeconds: number }>();
  const stalls = new Set<string>();
  const attempts: {
    operation: string;
    path: string;
    at: number;
    signal: AbortSignal | null | undefined;
  }[] = [];
  const nativeFetch = globalThis.fetch;
  vi.stubEnv('DISCORD_TOKEN', 'local-test-token');
  vi.stubEnv('DISCORD_API_BASE_URL', 'https://discord.test/api/v10');
  vi.stubEnv('DRASIL_WEB_E2E_FIXTURE_MODE', 'false');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname === '127.0.0.1') return nativeFetch(input, init);
    if (url.origin !== 'https://discord.test' || init?.method !== 'GET')
      throw new Error('Unexpected test HTTP boundary');
    const path = url.pathname.replace('/api/v10', '');
    const operation = currentReadRequestContext()?.operation ?? 'unknown';
    attempts.push({ operation, path, at: performance.now(), signal: init.signal });
    if (stalls.has(operation) && path === `/guilds/${guildId}`)
      return new Promise<Response>((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) throw new Error('Missing attempt cancellation signal');
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    const failure = failures.get(operation);
    if (failure && failure.path === path && failure.remaining-- > 0)
      return Response.json({ retry_after: failure.delaySeconds }, { status: 429 });
    if (path === `/guilds/${guildId}`)
      return Response.json({ id: guildId, owner_id: '100000000000000009', name: 'Test guild' });
    if (path === `/guilds/${guildId}/roles`)
      return Response.json([
        { id: guildId, name: 'everyone', permissions: '66560', position: 0, managed: false },
        { id: staffRoleId, name: 'staff', permissions: '0', position: 1, managed: false },
        { id: botRoleId, name: 'bot', permissions: '8', position: 2, managed: false },
      ]);
    if (path === `/guilds/${guildId}/members/${principal.userId}`)
      return Response.json({
        user: { id: principal.userId },
        roles: state.staff ? [staffRoleId] : [],
      });
    if (path === `/guilds/${guildId}/members/${botId}`)
      return Response.json({ user: { id: botId }, roles: [botRoleId] });
    if (path === '/users/@me') return Response.json({ id: botId, username: 'test-bot' });
    if (path === `/channels/${channelId}`)
      return Response.json({
        id: channelId,
        guild_id: guildId,
        name: 'test-channel',
        type: 0,
        permission_overwrites: state.visible
          ? []
          : [{ id: principal.userId, type: 1, allow: '0', deny: '1024' }],
      });
    if (path === `/channels/${channelId}/messages`)
      return Response.json([
        {
          id: messageId,
          channel_id: channelId,
          author: { id: principal.userId, username: 'test-actor' },
          content: 'Local message fixture',
          timestamp: '2026-10-23T00:00:00Z',
          attachments: [],
        },
      ]);
    throw new Error('Unexpected Discord test path');
  });
  const access = createWebDelegatedAccess({
    store: { findConnection: async () => grant },
    authority: createWebAuthority(),
    staffRoles: { loadRoleIds: async () => [staffRoleId] },
    guilds: {
      isActive: async () => true,
      listActive: async () => ({ guildIds: [guildId], nextCursor: null }),
    },
  });
  const repository = {
    read: vi.fn<QueryRepository['read']>(async (binding, query) => {
      if (binding.guildId !== guildId) throw new Error('Unexpected repository binding');
      return [{ key: { id: query.kind, timestamp: null }, value: { id: query.kind } }];
    }),
  };
  const messages = vi.fn(readDiscordMessages);
  const queries = createMcpQueries({
    access,
    repository,
    cursorSecret: 'c'.repeat(40),
    authorizeDiscordContent: createDiscordContentAuthorizer(access),
    messages,
  });
  return { queries, access, repository, messages, grant, state, failures, stalls, attempts };
}
