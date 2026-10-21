import { it, expect } from 'vitest';
import { createMcpReadTools } from './reads';
import { createMcpQueries, querySchema } from '../queries';
import { accessFixture, guildId, principal } from '../queryTestFixtures';
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
