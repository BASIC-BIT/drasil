import { currentReadRequestContext, withReadRequestContext } from '../../readRequestContext';
import { createWebDelegatedAccess } from '../access';
import { createWebAuthority } from '../../application/adapters/authority';
import { it, expect, vi } from 'vitest';
import { createMcpAudit } from '../audit';
import { createMcpReadTools } from './reads';
import { createMcpQueries, querySchema, type McpQueryDependencies } from '../queries';
import { accessFixture, guildId, principal } from '../queryTestFixtures';
it('audits final denied and successful query outcomes without changing authorized quota subjects', async () => {
  const { access, grant } = accessFixture();
  grant.selection = { mode: 'selected', guildIds: [guildId] };
  const read = vi.fn(async () => []);
  const queries = createMcpQueries({
    access,
    repository: { read },
    cursorSecret: 'test-cursor-secret-at-least-32-characters',
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
  const lines: string[] = [];
  const limit = vi.fn(async () => ({ kind: 'allowed' as const }));
  const cases = createMcpReadTools(
    queries,
    limit,
    createMcpAudit((line) => lines.push(line))
  ).find((tool) => tool.id === 'list_cases')!;
  const foreign = '100000000000000003';
  expect(await cases.handler(principal, { guildId: foreign })).toMatchObject({
    kind: 'denied',
    reason: 'guild_denied',
  });
  expect(read).not.toHaveBeenCalled();
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0])).toMatchObject({
    event: 'observation',
    outcome: 'denied',
    userId: principal.userId,
    clientId: principal.clientId,
    connectionId: principal.connectionId,
    grantVersion: principal.grantVersion,
  });
  expect(limit).toHaveBeenNthCalledWith(1, { ...principal, guildId: undefined }, 'read');
  expect(await cases.handler(principal, { guildId })).toMatchObject({ kind: 'allowed' });
  expect(JSON.parse(lines[1])).toMatchObject({
    event: 'observation',
    outcome: 'completed',
    guildId,
  });
  expect(limit).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledTimes(1);
  const brokenAudit = createMcpReadTools(queries, limit, async () => {
    throw new Error('PRIVATE_AUDIT');
  }).find((tool) => tool.id === 'list_cases')!;
  expect(await brokenAudit.handler(principal, { guildId: foreign })).toMatchObject({
    kind: 'denied',
    reason: 'guild_denied',
  });
  expect(lines.join('')).not.toMatch(/scopes|PRIVATE_AUDIT/);
});
it('advertises strict named object schemas and binds the trusted principal to read handlers', async () => {
  const { access } = accessFixture();
  const queries = createMcpQueries({
    access,
    repository: {
      read: async (binding) => [
        {
          key: { id: 'case', timestamp: null },
          value: { id: 'case', userId: binding.facts.userId },
        },
      ],
    },
    cursorSecret: 'test-cursor-secret-at-least-32-characters',
    authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
    messages: async () => [],
  });
  const tools = createMcpReadTools(queries);
  expect(tools.map((tool) => tool.toolName)).toEqual(
    querySchema.options.map((option) => `drasil_${option.shape.kind.value}`)
  );
  for (const tool of tools) {
    expect(tool.schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toMatchObject({
      type: 'object',
      additionalProperties: false,
    });
    expect(tool.annotations.readOnlyHint).toBe(true);
  }
  const cases = tools.find((tool) => tool.toolName === 'drasil_list_cases')!;
  expect(await cases.handler(principal, { guildId })).toMatchObject({
    kind: 'allowed',
    items: [{ userId: principal.userId }],
  });
  expect(await cases.handler(principal, { guildId, actorId: 'fake' })).toMatchObject({
    kind: 'denied',
  });
  expect(await cases.handler(principal, { guildId, kind: 'list_detections' })).toMatchObject({
    kind: 'denied',
  });
  const history = tools.find((tool) => tool.toolName === 'drasil_list_case_history')!;
  expect(history.description).toContain('outcomes');
  expect(history.description).toContain('detections');
});

it('concurrent_read_failure_identifies_its_dependency', async () => {
  const { grant, access: allowedAccess } = accessFixture();
  const lines: string[] = [];
  const ids: Record<string, string> = {};
  const log = vi.spyOn(console, 'info').mockImplementation((line: string) => lines.push(line));
  vi.stubEnv('DRASIL_WEB_BOT_TOKEN', 'TOKEN_SENTINEL');
  vi.stubGlobal('fetch', async () => {
    ids.discord = currentReadRequestContext()!.correlationId;
    await Promise.resolve();
    return new Response('BODY_SENTINEL', { status: 429 });
  });
  try {
    const providerAccess = createWebDelegatedAccess({
      store: { findConnection: async () => grant },
      authority: createWebAuthority(),
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => ({ guildIds: [], nextCursor: null }),
      },
    });
    function tool(access: typeof allowedAccess, repository: McpQueryDependencies['repository']) {
      return createMcpReadTools(
        createMcpQueries({
          access,
          repository,
          cursorSecret: 'test-cursor-secret-at-least-32-characters',
          authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
          messages: async () => [],
        })
      ).find((entry) => entry.id === 'list_cases')!;
    }
    const provider = tool(providerAccess, { read: async () => [] });
    const database = tool(allowedAccess, {
      read: async () => {
        ids.postgres = currentReadRequestContext()!.correlationId;
        await Promise.resolve();
        throw Object.assign(new Error('SQL_SENTINEL'), { code: '53300' });
      },
    });
    const results = await Promise.all([
      provider.handler(principal, { guildId }),
      database.handler(principal, { guildId }),
    ]);
    expect(results).toEqual([
      { kind: 'denied', reason: 'unavailable' },
      { kind: 'denied', reason: 'unavailable' },
    ]);
    expect(new Set(Object.values(ids)).size).toBe(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correlationId: ids.discord,
          dependency: 'discord',
          category: 'http_rate_limited',
          status: 429,
          operation: 'list_cases',
          boundary: 'discord_get',
          attempt: 1,
        }),
        expect.objectContaining({
          correlationId: ids.postgres,
          dependency: 'postgres',
          category: 'database_capacity',
          sqlState: '53300',
          operation: 'list_cases',
          boundary: 'query',
          attempt: 1,
        }),
      ])
    );
    expect(lines.join('\n')).not.toMatch(/TOKEN_SENTINEL|BODY_SENTINEL|SQL_SENTINEL/);
  } finally {
    log.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it('preserves swallowed grant and authority failures when an observer throws', async () => {
  const failure = Object.assign(new Error('SQL_SENTINEL'), { code: '08006' });
  const { grant } = accessFixture();
  for (const boundary of ['grant', 'authority'] as const) {
    const observed: unknown[] = [];
    const access = createWebDelegatedAccess({
      store: {
        findConnection: async () => {
          if (boundary === 'grant') throw failure;
          return grant;
        },
      },
      authority: {
        loadFresh: async () => {
          throw failure;
        },
      },
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => {
          throw failure;
        },
      },
      onDependencyFailure: (error) => {
        observed.push(error);
        throw new Error('observer failed');
      },
    });
    const lines: string[] = [];
    const log = vi.spyOn(console, 'info').mockImplementation((line: string) => lines.push(line));
    try {
      await withReadRequestContext({ operation: 'get_capabilities' }, async () => {
        expect(await access.authorizeRead(principal, { kind: 'cases', guildId })).toEqual({
          kind: 'denied',
          reason: 'unavailable',
        });
        expect(await access.listEligibleGuilds(principal, {})).toEqual({
          kind: 'denied',
          reason: 'unavailable',
        });
      });
      expect(observed).toEqual([failure, failure]);
      expect(lines.map((line) => JSON.parse(line))).toEqual([
        expect.objectContaining({
          dependency: 'postgres',
          sqlState: '08006',
          boundary: 'authority',
        }),
        expect.objectContaining({
          dependency: 'postgres',
          sqlState: '08006',
          boundary: 'authority',
        }),
      ]);
    } finally {
      log.mockRestore();
    }
  }
});

it('preserves query results when the diagnostic sink throws', async () => {
  const { access } = accessFixture();
  const tool = createMcpReadTools(
    createMcpQueries({
      access,
      repository: {
        read: async () => {
          throw Object.assign(new Error('SQL_SENTINEL'), { code: '08006' });
        },
      },
      cursorSecret: 'test-cursor-secret-at-least-32-characters',
      authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
      messages: async () => [],
    })
  ).find((entry) => entry.id === 'list_cases')!;
  const log = vi.spyOn(console, 'info').mockImplementation(() => {
    throw new Error('sink failed');
  });
  try {
    expect(await tool.handler(principal, { guildId })).toEqual({
      kind: 'denied',
      reason: 'unavailable',
    });
  } finally {
    log.mockRestore();
  }
});
