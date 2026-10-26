import { expect, it } from 'vitest';
import { recordReadDependency, classifyReadFailure } from './readDiagnostics';
import { withReadRequestContext } from './readRequestContext';

it('diagnostics_do_not_serialize_backend_payloads', async () => {
  const lines: string[] = [];
  const payload = {
    message: 'TOKEN_SENTINEL',
    body: 'BODY_SENTINEL',
    query: 'SQL_SENTINEL',
    code: '53300',
  };
  const value = await withReadRequestContext({ operation: 'list_cases' }, async () => {
    const event = {
      ...classifyReadFailure(payload),
      boundary: 'query' as const,
      latencyMs: 2,
      attempt: 1,
    };
    recordReadDependency({ ...event, ...payload }, (line) => lines.push(line));
    recordReadDependency(event, () => {
      throw payload;
    });
    return 'unchanged';
  });
  expect(value).toBe('unchanged');
  expect(JSON.parse(lines[0])).toMatchObject({
    dependency: 'postgres',
    category: 'database_capacity',
    sqlState: '53300',
    operation: 'list_cases',
    attempt: 1,
  });
  expect(lines.join('\n')).not.toMatch(/TOKEN_SENTINEL|BODY_SENTINEL|SQL_SENTINEL/);
});

it('rejects unrecognized status codes and free form operation labels', async () => {
  const lines: string[] = [];
  await withReadRequestContext({ operation: 'TOKEN_SENTINEL' }, async () => {
    recordReadDependency(
      {
        dependency: 'internal',
        category: 'unknown',
        status: NaN,
        latencyMs: Infinity,
        attempt: 1,
        boundary: 'query',
      },
      (line) => lines.push(line)
    );
  });
  expect(JSON.parse(lines[0])).toMatchObject({
    operation: 'unknown',
    status: null,
    latencyMs: null,
  });
  expect(lines.join('\n')).not.toContain('TOKEN_SENTINEL');
});

it('treats an unreadable backend error as unknown', () => {
  const error = Object.defineProperty({}, 'code', {
    get() {
      throw new Error('SQL_SENTINEL');
    },
  });
  expect(classifyReadFailure(error)).toEqual({
    dependency: 'internal',
    category: 'unknown',
    status: null,
  });
});

it('bounds selected workspace source diagnostics without provider text or identities', async () => {
  const lines: string[] = [];
  await withReadRequestContext({ operation: 'selected_workspace_read' }, async () => {
    const event = {
      dependency: 'discord' as const,
      category: 'http_client_error' as const,
      boundary: 'authority' as const,
      source: 'member' as const,
      status: 404,
      latencyMs: null,
      attempt: 1,
      body: 'PRIVATE_BODY',
      guildId: 'PRIVATE_GUILD',
    };
    recordReadDependency(event, (line) => lines.push(line));
    recordReadDependency({ ...event, source: 'PRIVATE_SOURCE' as 'member' }, (line) =>
      lines.push(line)
    );
  });
  expect(JSON.parse(lines[0])).toMatchObject({
    operation: 'selected_workspace_read',
    source: 'member',
    status: 404,
  });
  expect(JSON.parse(lines[1])).not.toHaveProperty('source');
  expect(lines.join()).not.toContain('PRIVATE');
});
