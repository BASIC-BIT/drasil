import { Pool } from 'pg';
import {
  createIntentService,
  type DelegatedPrincipal,
  type IntentStore,
  type IntentInvocation,
  type IntentResolver,
  type DelegatedAccess,
  encodeIntentDelivery,
  setupServerRecordSchema,
} from '@drasil/application';
import {
  createDelegationStore,
  buildEnqueueStatement,
  type DelegationDatabase,
  type DelegationSqlValue,
} from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import { createBotDelegationDatabase } from '../../application/adapters/delegation';
import { getPrismaClient } from '../testDb';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const invocation: IntentInvocation = {
  workflowId: 'clear_moderation_queue',
  guildId: 'guild',
  input: {},
  idempotencyKey: 'key',
};
const resolver: IntentResolver = {
  resolve: async () => ({
    delivery: { kind: 'queued', command: { kind: 'clear_moderation_queue' } },
    preconditions: { kind: 'none' },
    relevantState: { enabled: true },
    summary: 'Clear moderation queue',
    previewExpiresAt: null,
  }),
};
const access = {
  authorizeWorkflowId: async () => ({ kind: 'allowed' as const }),
  authorizeWorkflow: async () => ({ kind: 'allowed' }),
} as unknown as DelegatedAccess;

integration.each(['pg', 'prisma'] as const)('MCP intents via %s', (driver) => {
  let pool: Pool;
  let database: DelegationDatabase;
  let store: ReturnType<typeof createDelegationStore>;
  let principal: DelegatedPrincipal;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => pool.end());
  beforeEach(async () => {
    database =
      driver === 'pg'
        ? createWebDelegationDatabase(pool)
        : createBotDelegationDatabase(getPrismaClient());
    store = createDelegationStore(database);
    await pool.query("insert into servers (guild_id) values ('guild')");
    const grant = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes: ['drasil:moderate', 'drasil:configure'],
    });
    principal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
  });
  function service(s: IntentStore = store) {
    return createIntentService({ store: s, access, resolver });
  }
  async function count(table: 'mcp_executions' | 'moderation_action_requests') {
    return Number((await pool.query(`select count(*) from ${table}`)).rows[0].count);
  }
  it('links one execution for concurrent confirmation', async () => {
    const intent = await service().prepareIntent(principal, invocation);
    const concurrentResults = await Promise.all(
      Array.from({ length: 8 }, () =>
        service().acceptIntent(principal, intent.confirmationId, 'client_confirmation')
      )
    );
    expect(new Set(concurrentResults.map((r) => r.executionId)).size).toBe(1);
    expect(await count('mcp_executions')).toBe(1);
    expect(await count('moderation_action_requests')).toBe(1);
    const loaded = await store.loadIntent(principal, intent.confirmationId);
    expect(loaded).toMatchObject({
      state: 'consumed',
      executionId: concurrentResults[0].executionId,
      confirmationMethod: 'client_confirmation',
    });
    const queue = (await pool.query('select * from moderation_action_requests')).rows[0];
    expect(queue.metadata.delegation).toMatchObject({
      executionId: concurrentResults[0].executionId,
      connectionId: principal.connectionId,
      grantVersion: 1,
      commandDigest:
        intent.authorizedDelivery.kind === 'queued' ? intent.authorizedDelivery.commandDigest : '',
    });
    expect(queue.id).toBe(concurrentResults[0].queueRequestId);
  });
  it.each(['cancelled', 'denied', 'expired'] as const)(
    'never accepts a %s intent',
    async (state) => {
      const intent = await service().prepareIntent(principal, invocation);
      if (state === 'cancelled') await store.cancelIntent(principal, intent.confirmationId);
      else if (state === 'denied') await store.denyIntent(principal, intent.confirmationId);
      else
        await pool.query(
          'update mcp_intents set expires_at = created_at where confirmation_id = $1',
          [intent.confirmationId]
        );
      await expect(
        store.acceptIntent(
          principal,
          intent.confirmationId,
          'client_confirmation',
          encodeIntentDelivery(intent)
        )
      ).rejects.toThrow(state);
      expect(await count('mcp_executions')).toBe(0);
      expect(await count('moderation_action_requests')).toBe(0);
    }
  );
  it.each(['queue', 'consumption'])(
    'rolls back all writes when %s persistence fails',
    async (phase) => {
      const intent = await service().prepareIntent(principal, invocation);
      const failing = createDelegationStore({
        ...database,
        transaction: (operation) =>
          database.transaction((client) =>
            operation({
              query: async <Row extends Record<string, unknown>>(
                text: string,
                values?: readonly DelegationSqlValue[]
              ): Promise<{ rows: Row[] }> => {
                const result = await client.query<Row>(text, values);
                if (
                  (phase === 'queue' &&
                    text.startsWith('insert into moderation_action_requests')) ||
                  (phase === 'consumption' &&
                    text.startsWith("update mcp_intents set state = 'consumed'"))
                ) {
                  throw new Error('injected persistence failure');
                }
                return result;
              },
            })
          ),
      });
      await expect(
        service(failing).acceptIntent(principal, intent.confirmationId, 'discord')
      ).rejects.toThrow('injected persistence failure');
      expect((await store.loadIntent(principal, intent.confirmationId))?.state).toBe('pending');
      expect(await count('mcp_executions')).toBe(0);
      expect(await count('moderation_action_requests')).toBe(0);
    }
  );
  it('preserves foreign queue provenance and does not adopt its receipt', async () => {
    const intent = await service().prepareIntent(principal, invocation);
    const delivery = encodeIntentDelivery(intent);
    if ('kind' in delivery) throw new Error('Expected queue delivery');
    const foreign = (
      await pool.query(
        "insert into moderation_action_requests (server_id, action_type, actor_id, actor_surface, idempotency_key, metadata) values ('guild','clear_moderation_queue','actor','mcp',$1,'{\"foreign\":true}') returning *",
        [delivery.idempotencyKey]
      )
    ).rows[0];
    await expect(
      service().acceptIntent(principal, intent.confirmationId, 'website')
    ).rejects.toThrow('queue_conflict');
    expect((await pool.query('select * from moderation_action_requests')).rows[0]).toEqual(foreign);
    expect(await count('mcp_executions')).toBe(0);
    expect((await store.loadIntent(principal, intent.confirmationId))?.state).toBe('pending');
  });
  it('rejects changed options, reason, target, guild and principal on retries', async () => {
    const intent = await service().prepareIntent(principal, invocation);
    await expect(
      service().prepareIntent(principal, { ...invocation, guildId: 'other' })
    ).rejects.toThrow('idempotency_conflict');
    for (const field of ['userId', 'clientId', 'connectionId', 'grantVersion'] as const) {
      const changed = {
        ...principal,
        [field]:
          field === 'grantVersion'
            ? 2
            : field === 'connectionId'
              ? '00000000-0000-0000-0000-000000000000'
              : 'other',
      };
      await expect(
        store.acceptIntent(
          changed,
          intent.confirmationId,
          'client_confirmation',
          encodeIntentDelivery(intent)
        )
      ).rejects.toThrow();
    }
    const delivery = encodeIntentDelivery(intent);
    if ('kind' in delivery) throw new Error('Expected queue');
    for (const change of [
      { targetUserId: 'other' },
      { metadata: { reason: 'changed' } },
      { actionType: 'sync_moderation_queue' },
    ]) {
      await expect(
        store.acceptIntent(principal, intent.confirmationId, 'client_confirmation', {
          ...delivery,
          ...change,
        } as typeof delivery)
      ).rejects.toThrow('delivery_mismatch');
    }
    expect(await count('mcp_executions')).toBe(0);
  });
  it('rejects revoked and changed grants before queue insertion', async () => {
    const intent = await service().prepareIntent(principal, invocation);
    await store.revokeConnection(principal, 1);
    await expect(
      service().acceptIntent(principal, intent.confirmationId, 'discord')
    ).rejects.toThrow('invalid_grant');
    expect(await count('moderation_action_requests')).toBe(0);
  });
  it('saves one immutable intent for concurrent exact retries', async () => {
    const intents = await Promise.all(
      Array.from({ length: 6 }, () => service().prepareIntent(principal, invocation))
    );
    expect(new Set(intents.map((i) => i.confirmationId)).size).toBe(1);
    expect(intents[0].createdAt).toBeInstanceOf(Date);
  });
  it('bounds pending intents per connection without counting expired entries', async () => {
    const original = await service().prepareIntent(principal, invocation);
    // Historical live intents fill capacity independently of this minute's insertion budget.
    await pool.query(
      `insert into mcp_intents (confirmation_id,connection_id,user_id,client_id,grant_version,idempotency_key,invocation_digest,input,resolved,created_at,expires_at)
      select 'capacity-'||n,connection_id,user_id,client_id,grant_version,'capacity-'||n,invocation_digest,input,resolved,created_at,expires_at
      from mcp_intents cross join generate_series(1,127)n where confirmation_id=$1`,
      [original.confirmationId]
    );
    await expect(
      service().prepareIntent(principal, { ...invocation, idempotencyKey: 'overflow' })
    ).rejects.toThrow('capacity');
    await pool.query('update mcp_intents set expires_at = created_at where confirmation_id = $1', [
      original.confirmationId,
    ]);
    expect(
      (await service().prepareIntent(principal, { ...invocation, idempotencyKey: 'after-expiry' }))
        .state
    ).toBe('pending');
  });
  it('serializes the actor cap across different connections', async () => {
    const original = await service().prepareIntent(principal, invocation);
    // Seed 1,023 pending records across eight connections, below each connection cap.
    for (let batch = 0; batch < 8; batch++) {
      const grant = await store.createConnection({
        userId: principal.userId,
        clientId: `client-${batch}`,
        selection: { mode: 'all_eligible' },
        scopes: ['drasil:moderate'],
      });
      await pool.query(
        `insert into mcp_intents (confirmation_id, connection_id, user_id, client_id, grant_version, idempotency_key, invocation_digest, input, resolved, created_at, expires_at)
        select $1 || '-' || n, $2::uuid, user_id, $3, 1, $1 || '-' || n, invocation_digest, input, resolved, created_at, expires_at
        from mcp_intents cross join generate_series(1, $4::integer) n where confirmation_id = $5`,
        [
          `actor-cap-${batch}`,
          grant.connectionId,
          grant.clientId,
          batch === 7 ? 126 : 128,
          original.confirmationId,
        ]
      );
    }
    const grant = await store.createConnection({
      userId: principal.userId,
      clientId: 'competing',
      selection: { mode: 'all_eligible' },
      scopes: ['drasil:moderate'],
    });
    const other: DelegatedPrincipal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
    const results = await Promise.allSettled([
      service().prepareIntent(principal, { ...invocation, idempotencyKey: 'last-slot' }),
      service().prepareIntent(other, { ...invocation, idempotencyKey: 'last-slot' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.reason.message).toBe('capacity');
    expect(
      Number(
        (await pool.query("select count(*) from mcp_intents where state = 'pending'")).rows[0].count
      )
    ).toBe(1024);
  });
  it('does not allow an ordinary enqueue to overwrite accepted delegated provenance', async () => {
    const intent = await service().prepareIntent(principal, invocation);
    await service().acceptIntent(principal, intent.confirmationId, 'client_confirmation');
    const delivery = encodeIntentDelivery(intent);
    if ('kind' in delivery) throw new Error('Expected queue');
    const original = (await pool.query('select * from moderation_action_requests')).rows[0];
    const statement = buildEnqueueStatement({ ...delivery, metadata: { overwritten: true } });
    await pool.query(statement.text, [...statement.values]);
    expect((await pool.query('select * from moderation_action_requests')).rows[0]).toEqual(
      original
    );
  });
  it('serializes competing setup acceptance across connections in the same queue transaction', async () => {
    const approvedState = setupServerRecordSchema.parse({
      guild_id: 'guild',
      settings: {},
      case_role_id: null,
      admin_channel_id: null,
      verification_channel_id: null,
      admin_notification_role_id: null,
      heuristic_message_threshold: 5,
      heuristic_message_timeframe_seconds: 60,
      heuristic_suspicious_keywords: [],
      created_at: null,
      updated_at: null,
      updated_by: null,
      is_active: true,
    });
    const setup = createIntentService({
      store,
      access,
      resolver: {
        resolve: async () => ({
          delivery: {
            kind: 'queued',
            command: {
              kind: 'complete_setup_verification',
              mode: 'provision',
              adminChannelId: 'channel',
              onboardingWizard: false,
            },
          },
          preconditions: { kind: 'setup', approvedState },
          relevantState: {},
          summary: 'Admin channel: none → channel',
          previewExpiresAt: null,
        }),
      },
    });
    const grant = await store.createConnection({
      userId: principal.userId,
      clientId: 'second-setup',
      selection: { mode: 'all_eligible' },
      scopes: ['drasil:configure'],
    });
    const other: DelegatedPrincipal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
    const request: IntentInvocation = {
      guildId: 'guild',
      workflowId: 'complete_setup_verification_provision',
      idempotencyKey: 'setup',
      input: { adminChannelId: 'channel' },
    };
    const first = await setup.prepareIntent(principal, request);
    const second = await setup.prepareIntent(other, request);
    const results = await Promise.allSettled([
      setup.acceptIntent(principal, first.confirmationId, 'website'),
      setup.acceptIntent(other, second.confirmationId, 'discord'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason.message).toBe(
      'queue_conflict'
    );
    expect(await count('mcp_executions')).toBe(1);
    expect(await count('moderation_action_requests')).toBe(1);
  });
  it('records direct execution separately from private queue tokens', async () => {
    const direct = createIntentService({
      store,
      access,
      resolver: {
        resolve: async () => ({
          delivery: { kind: 'direct' },
          preconditions: { kind: 'none' },
          relevantState: {},
          summary: 'Acknowledge attention',
          previewExpiresAt: null,
        }),
      },
    });
    const intent = await direct.prepareIntent(principal, {
      workflowId: 'acknowledge_attention',
      guildId: 'guild',
      idempotencyKey: 'direct',
      input: { itemIds: ['item'] },
    });
    const execution = await direct.acceptWithoutConfirmation(principal, intent.confirmationId);
    expect(execution.executionId).toMatch(/^[a-f0-9-]{36}$/);
    expect(execution.queueRequestId).toBeNull();
    expect(execution.startedAt).toBeNull();
    expect(await count('moderation_action_requests')).toBe(0);
  });
});
