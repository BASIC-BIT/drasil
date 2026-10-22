import { Pool } from 'pg';
import type { ConnectionGrant, DelegatedPrincipal, DelegationStore } from '@drasil/application';
import { createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import { createBotDelegationDatabase } from '../../application/adapters/delegation';
import { getPrismaClient } from '../testDb';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;

function principal(grant: ConnectionGrant): DelegatedPrincipal {
  return {
    userId: grant.userId,
    clientId: grant.clientId,
    connectionId: grant.connectionId,
    grantVersion: grant.version,
    scopes: grant.scopes,
  };
}

integration.each(['pg', 'prisma'] as const)('MCP connections via %s', (driver) => {
  let pool: Pool;
  let store: DelegationStore;
  let otherStore: DelegationStore;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const web = createDelegationStore(createWebDelegationDatabase(pool));
    const bot = createDelegationStore(createBotDelegationDatabase(getPrismaClient()));
    store = driver === 'pg' ? web : bot;
    otherStore = driver === 'pg' ? bot : web;
  });
  afterAll(async () => pool.end());

  function create() {
    return store.createConnection({
      userId: '1234567890123456789',
      clientId: 'test-client',
      selection: { mode: 'selected', guildIds: ['2345678901234567890'] },
      scopes: ['drasil:read', 'drasil:moderate'],
    });
  }

  it('stores selected guilds and immutable identity across runtimes', async () => {
    const grant = await create();
    expect(grant).toMatchObject({
      version: 1,
      userId: '1234567890123456789',
      clientId: 'test-client',
      selection: { mode: 'selected', guildIds: ['2345678901234567890'] },
      scopes: ['drasil:read', 'drasil:moderate'],
      revokedAt: null,
    });
    expect(grant.createdAt).toBeInstanceOf(Date);
    expect(await otherStore.findConnection(grant.connectionId)).toEqual(grant);
    expect((await create()).connectionId).not.toBe(grant.connectionId);
  });

  it('stores all eligible selection and replaces selected guild rows atomically', async () => {
    const grant = await create();
    const result = await store.updateSelection(principal(grant), { mode: 'all_eligible' }, 1);
    expect(result).toMatchObject({
      kind: 'updated',
      grant: { version: 2, selection: { mode: 'all_eligible' } },
    });
    expect(await otherStore.findConnection(grant.connectionId)).toMatchObject({
      version: 2,
      selection: { mode: 'all_eligible' },
    });
    const rows = await pool.query('select * from mcp_connection_guilds where connection_id = $1', [
      grant.connectionId,
    ]);
    expect(rows.rows).toHaveLength(0);
    const allEligible = await store.createConnection({
      userId: grant.userId,
      clientId: grant.clientId,
      selection: { mode: 'all_eligible' },
      scopes: ['drasil:configure'],
    });
    const selected = await store.updateSelection(
      principal(allEligible),
      { mode: 'selected', guildIds: ['9', '8', '9'] },
      1
    );
    expect(selected).toMatchObject({
      kind: 'updated',
      grant: { selection: { mode: 'selected', guildIds: ['8', '9'] } },
    });
    expect(await otherStore.findConnection(allEligible.connectionId)).toMatchObject({
      selection: { mode: 'selected', guildIds: ['8', '9'] },
    });
  });

  it('allows only one concurrent grant update', async () => {
    const grant = await create();
    const results = await Promise.all([
      store.updateSelection(principal(grant), { mode: 'selected', guildIds: ['first'] }, 1),
      otherStore.updateSelection(principal(grant), { mode: 'selected', guildIds: ['second'] }, 1),
    ]);
    const successes = results.filter((result) => result.kind === 'updated');
    expect(successes).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'conflict')).toHaveLength(1);
    const stored = await store.findConnection(grant.connectionId);
    if (!stored) throw new Error('Expected persisted connection');
    expect(stored.version).toBe(2);
    expect(stored).toEqual(successes[0].grant);
  });

  it.each(['userId', 'clientId'] as const)(
    'denies another %s without changing any grant rows',
    async (field) => {
      const grant = await create();
      const attacker = { ...principal(grant), [field]: 'another-identity' };
      expect(await store.updateSelection(attacker, { mode: 'all_eligible' }, 1)).toEqual({
        kind: 'denied',
        reason: 'identity_mismatch',
      });
      expect(await store.revokeConnection(attacker, 1)).toEqual({
        kind: 'denied',
        reason: 'identity_mismatch',
      });
      expect(await otherStore.findConnection(grant.connectionId)).toEqual(grant);
    }
  );

  it('rejects stale principals even when supplied the current expected version', async () => {
    const grant = await create();
    const updated = await store.updateSelection(principal(grant), { mode: 'all_eligible' }, 1);
    expect(
      await store.updateSelection(
        principal(grant),
        { mode: 'selected', guildIds: ['unexpected'] },
        2
      )
    ).toEqual({ kind: 'conflict' });
    expect(await store.revokeConnection(principal(grant), 2)).toEqual({ kind: 'conflict' });
    expect(await store.findConnection(grant.connectionId)).toEqual(
      updated.kind === 'updated' ? updated.grant : null
    );
  });

  it('makes revocation immediately visible to the other runtime and prevents further edits', async () => {
    const grant = await create();
    const result = await store.revokeConnection(principal(grant), 1);
    if (result.kind !== 'updated') throw new Error('Expected successful revocation');
    expect(result.grant.version).toBe(2);
    expect(result.grant.revokedAt).toBeInstanceOf(Date);
    expect(await otherStore.findConnection(grant.connectionId)).toEqual(result.grant);
    expect(
      await otherStore.updateSelection(principal(result.grant), { mode: 'all_eligible' }, 2)
    ).toEqual({ kind: 'denied', reason: 'revoked' });
    expect(await otherStore.revokeConnection(principal(result.grant), 2)).toEqual({
      kind: 'denied',
      reason: 'revoked',
    });
    expect(await otherStore.findConnection(grant.connectionId)).toEqual(result.grant);
  });

  it('serializes selection updates against revocation', async () => {
    const grant = await create();
    const results = await Promise.all([
      store.updateSelection(principal(grant), { mode: 'all_eligible' }, 1),
      otherStore.revokeConnection(principal(grant), 1),
    ]);
    const successes = results.filter((result) => result.kind === 'updated');
    expect(successes).toHaveLength(1);
    expect(await store.findConnection(grant.connectionId)).toEqual(successes[0].grant);
  });

  it('returns missing grants without exposing other connections', async () => {
    const grant = await create();
    const missing = { ...principal(grant), connectionId: '00000000-0000-0000-0000-000000000000' };
    expect(await store.findConnection(missing.connectionId)).toBeNull();
    expect(await store.updateSelection(missing, { mode: 'all_eligible' }, 1)).toEqual({
      kind: 'denied',
      reason: 'not_found',
    });
    expect(await store.revokeConnection(missing, 1)).toEqual({
      kind: 'denied',
      reason: 'not_found',
    });
  });

  it('rolls back every write when a database transaction fails', async () => {
    const database =
      driver === 'pg'
        ? createWebDelegationDatabase(pool)
        : createBotDelegationDatabase(getPrismaClient());
    const grant = await create();
    await expect(
      database.transaction(async (transaction) => {
        await transaction.query(
          'update mcp_connections set version = version + 1 where id = $1::uuid returning id',
          [grant.connectionId]
        );
        await transaction.query(
          'delete from mcp_connection_guilds where connection_id = $1::uuid returning connection_id',
          [grant.connectionId]
        );
        throw new Error('rollback-test');
      })
    ).rejects.toThrow('rollback-test');
    expect(await otherStore.findConnection(grant.connectionId)).toEqual(grant);
  });
});
