import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { createWebDelegationDatabase } from './adapters/database';
import { createMcpLimits } from './limits';
import { createDelegationStore } from '@drasil/application/postgres';
import { createDelegatedAccess } from '@drasil/application';
import { createMcpQueries } from './queries';
import { createMcpReadTools } from './tools/reads';
if (process.env.TEST_DATABASE_URL) {
  const database = new URL(process.env.TEST_DATABASE_URL);
  if (
    !['127.0.0.1', 'localhost'].includes(database.hostname) ||
    !database.pathname.endsWith('_test')
  )
    throw new Error('MCP limits tests require a disposable loopback *_test database.');
}
describe.skipIf(!process.env.TEST_DATABASE_URL)('shared persisted budgets', () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const db = createWebDelegationDatabase(pool);
  const subject = {
    userId: '100',
    clientId: 'client',
    connectionId: '00000000-0000-4000-8000-000000000001',
    grantVersion: 1,
    scopes: ['drasil:read'] as const,
    guildId: '200',
  };
  beforeEach(async () => {
    await pool.query('TRUNCATE mcp_rate_buckets,mcp_metadata_permits');
  });
  afterAll(async () => {
    await pool.end();
  });
  it('shares read limits across web instances', async () => {
    const instances = [createMcpLimits(db), createMcpLimits(createWebDelegationDatabase(pool))];
    let lastDecision = { kind: 'allowed' } as Awaited<
      ReturnType<(typeof instances)[0]['checkMcpLimit']>
    >;
    for (let i = 0; i < 121; i++)
      lastDecision = await instances[i % 2].checkMcpLimit(subject, 'read');
    expect(lastDecision.kind).toBe('limited');
  });
  it('never charges a foreign guild through actual read tools and persisted grants', async () => {
    const selected = '88000000000000001';
    const foreign = '88000000000000002';
    const store = createDelegationStore(db);
    const grant = await store.createConnection({
      userId: subject.userId,
      clientId: subject.clientId,
      selection: { mode: 'selected', guildIds: [selected] },
      scopes: ['drasil:read'],
    });
    const principal = { ...subject, connectionId: grant.connectionId };
    const access = createDelegatedAccess({
      store,
      authority: {
        loadFresh: async (guildId, userId) => ({
          guildId,
          userId,
          present: true,
          owner: false,
          permissions: '8',
          roleIds: [],
        }),
      },
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => ({ guildIds: [selected], nextCursor: null }),
      },
    });
    const read = vi.fn(async () => []);
    const queries = createMcpQueries({
      access,
      repository: { read },
      cursorSecret: 'isolated-query-cursor-secret-value-32',
      authorizeDiscordContent: async () => ({ kind: 'denied', reason: 'permission_denied' }),
      messages: async () => [],
    });
    const limits = createMcpLimits(db);
    const tools = createMcpReadTools(queries, limits.checkMcpLimit);
    const cases = tools.find((tool) => tool.id === 'list_cases')!;
    expect(await cases.handler(principal, { guildId: foreign })).toMatchObject({
      kind: 'denied',
      reason: 'guild_denied',
    });
    expect(
      (await pool.query('select * from mcp_rate_buckets where subject=$1', ['guild:' + foreign]))
        .rowCount
    ).toBe(0);
    expect(await cases.handler(principal, { guildId: selected })).toMatchObject({
      kind: 'allowed',
    });
    expect(
      (
        await pool.query(
          'select cardinality(starts) as count from mcp_rate_buckets where subject=$1',
          ['guild:' + selected]
        )
      ).rows[0].count
    ).toBe(1);
    expect(
      (
        await pool.query(
          'select cardinality(starts) as count from mcp_rate_buckets where subject=$1',
          ['connection:' + grant.connectionId]
        )
      ).rows[0].count
    ).toBe(2);
    for (const reason of ['unavailable', 'permission_denied'] as const) {
      const authorization = vi
        .spyOn(access, 'authorizeRead')
        .mockResolvedValueOnce({ kind: 'denied', reason });
      expect(await cases.handler(principal, { guildId: selected })).toMatchObject({
        kind: 'denied',
        reason,
      });
      expect(authorization).toHaveBeenCalledTimes(1);
      authorization.mockRestore();
    }
    expect(
      (
        await pool.query(
          'select cardinality(starts) as count from mcp_rate_buckets where subject=$1',
          ['guild:' + selected]
        )
      ).rows[0].count
    ).toBe(1);
    expect(read).toHaveBeenCalledTimes(1);
    const failing = createMcpReadTools(queries, async () => {
      throw new Error('limiter unavailable');
    }).find((tool) => tool.id === 'list_cases')!;
    expect(await failing.handler(principal, { guildId: selected })).toMatchObject({
      kind: 'denied',
      reason: 'unavailable',
    });
    expect(read).toHaveBeenCalledTimes(1);
    await pool.query('delete from mcp_connections where id=$1', [grant.connectionId]);
  });
  it('does not partially charge when one identity is exhausted', async () => {
    const limits = createMcpLimits(db);
    for (let i = 0; i < 30; i++) await limits.checkMcpLimit(subject, 'submission');
    const other = { ...subject, userId: '101', guildId: '201' };
    expect((await limits.checkMcpLimit(other, 'submission')).kind).toBe('limited');
    const rows = await pool.query(
      "select * from mcp_rate_buckets where subject in ('user:101','guild:201')"
    );
    expect(rows.rowCount).toBe(0);
  });
  it('atomically bounds concurrent registration by IP and global identity', async () => {
    const limits = createMcpLimits(db);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        limits.checkMcpLimit({ registrationIpHash: 'a'.repeat(64) }, 'registration')
      )
    );
    expect(results.filter((r) => r.kind === 'allowed')).toHaveLength(10);
  });
  it('keeps all sixteen metadata permits until explicit completion', async () => {
    const limits = createMcpLimits(db);
    const permits = await Promise.all(
      Array.from({ length: 16 }, (_, i) => limits.acquireMetadata(`https://client${i}.example`))
    );
    await expect(limits.acquireMetadata('https://other.example')).rejects.toThrow(
      'metadata_limited'
    );
    await permits[0]();
    await permits[0]();
    await expect(limits.acquireMetadata('https://other.example')).resolves.toBeTypeOf('function');
  });
  it('repeated conditional responses release shared capacity across transports', async () => {
    const { boundMetadataTransport } = await import('./metadata');
    const transports = [
      createMcpLimits(db),
      createMcpLimits(createWebDelegationDatabase(pool)),
    ].map((l) =>
      boundMetadataTransport(l.acquireMetadata, async () => new Response(null, { status: 304 }))
    );
    for (let i = 0; i < 20; i++)
      expect((await transports[i % 2]('https://client.example')).status).toBe(304);
    expect((await pool.query('select * from mcp_metadata_permits')).rowCount).toBe(0);
  });
  it('recovers shared capacity after rejected headers without downstream readers', async () => {
    const { boundMetadataTransport } = await import('./metadata');
    const transports = [
      createMcpLimits(db),
      createMcpLimits(createWebDelegationDatabase(pool)),
    ].map((l) =>
      boundMetadataTransport(
        l.acquireMetadata,
        async () =>
          new Response(new ReadableStream({ cancel() {} }), {
            headers: { 'content-type': 'text/html' },
          })
      )
    );
    for (let index = 0; index < 20; index++) await transports[index % 2]('https://client.example');
    expect((await pool.query('select * from mcp_metadata_permits')).rowCount).toBe(0);
  });
  it.each([
    ['read', 'user', 240],
    ['submission', 'user', 60],
    ['new_intent', 'user', 40],
    ['read', 'guild', 600],
    ['submission', 'guild', 60],
    ['new_intent', 'guild', 40],
  ] as const)(
    'shares %s limits per %s at %s',
    async (category, dimension, maximum) => {
      const limits = createMcpLimits(db);
      for (let i = 0; i <= maximum; i++) {
        const candidate = {
          ...subject,
          connectionId: `connection-${i}`,
          userId: dimension === 'user' ? 'shared-user' : `actor-${i}`,
          guildId: dimension === 'guild' ? 'shared-guild' : `guild-${i}`,
        };
        const decision = await limits.checkMcpLimit(candidate, category);
        expect(decision.kind).toBe(i === maximum ? 'limited' : 'allowed');
      }
    },
    20_000
  );
  it('bounds metadata starts globally and per origin after permits finish', async () => {
    const limits = createMcpLimits(db);
    for (let i = 0; i < 30; i++) await (await limits.acquireMetadata('https://one.example'))();
    await expect(limits.acquireMetadata('https://one.example')).rejects.toThrow('metadata_limited');
    for (let i = 0; i < 90; i++)
      await (
        await limits.acquireMetadata(`https://origin${i}.example`)
      )();
    await expect(limits.acquireMetadata('https://extra.example')).rejects.toThrow(
      'metadata_limited'
    );
    expect((await pool.query('select * from mcp_metadata_permits')).rowCount).toBe(0);
  });
});
