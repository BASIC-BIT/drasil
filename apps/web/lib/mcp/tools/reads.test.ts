import { it, expect, vi } from 'vitest';
import { createMcpAudit } from '../audit';
import { createMcpReadTools } from './reads';
import { createMcpQueries, querySchema } from '../queries';
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
