import { Pool } from 'pg';
import {
  createDelegatedActionService,
  createDelegatedAccess,
  createMcpAudit,
  createAlternativeApprovals,
  decodeQueuedAction,
  type DelegatedPrincipal,
  type IntentResolver,
  type AuthorityFacts,
} from '@drasil/application';
import {
  createMcpOperationalStore,
  createDelegationStore,
  createActorApprovalStore,
} from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import {
  createDelegatedWorkerAdmission,
  createBotDelegationDatabase,
} from '../../application/adapters/delegation';
import { prepareQueuedRequest } from '../../application/requestRuntime';
import { getPrismaClient } from '../testDb';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration.each(['pg', 'prisma'] as const)('MCP operational queue lifecycle via %s', (driver) => {
  let pool: Pool;
  let store: ReturnType<typeof createDelegationStore>;
  let principal: DelegatedPrincipal;
  let access: ReturnType<typeof createDelegatedAccess>;
  let authorityFacts: AuthorityFacts;
  const resolver: IntentResolver = {
    resolve: async () => ({
      delivery: { kind: 'queued', command: { kind: 'clear_moderation_queue' } },
      preconditions: { kind: 'none' },
      relevantState: {},
      summary: 'Clear queue',
      previewExpiresAt: null,
    }),
  };
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => pool.end());
  beforeEach(async () => {
    store = createDelegationStore(
      driver === 'pg'
        ? createWebDelegationDatabase(pool)
        : createBotDelegationDatabase(getPrismaClient())
    );
    await pool.query("insert into servers (guild_id) values ('guild')");
    const grant = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes: ['drasil:read', 'drasil:moderate'],
    });
    principal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
    authorityFacts = {
      guildId: 'guild',
      userId: 'actor',
      present: true,
      owner: false,
      permissions: '8',
      roleIds: [],
    };
    access = createDelegatedAccess({
      store,
      authority: {
        loadFresh: async () => authorityFacts,
      },
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => ({ guildIds: ['guild'], nextCursor: null }),
      },
    });
  });
  const invocation = {
    workflowId: 'clear_moderation_queue' as const,
    guildId: 'guild',
    idempotencyKey: 'key',
    input: {},
  };
  function service() {
    return createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
    });
  }
  async function accept() {
    const action = service();
    const intent = await action.submit(principal, invocation);
    expect(intent.state).toBe('confirmation_required');
    return action.confirm(principal, intent.confirmationId!, 'client_confirmation');
  }

  async function claimed() {
    const receipt = await accept();
    const repository = new ModerationActionRequestRepository(getPrismaClient());
    const request = (await repository.claimNext())!;
    const worker = createDelegatedWorkerAdmission({ store, access });
    return { receipt, repository, request, worker };
  }
  it.each([false, true])(
    'settles unresumable crash admitted=%s through real polling without replay',
    async (admitted) => {
      const f = await claimed();
      if (admitted)
        expect(
          (
            await f.worker.authorizeDelegatedRequest(
              f.request,
              false,
              decodeQueuedAction(f.request)
            )
          ).kind
        ).toBe('new_execution');
      await pool.query(
        "update moderation_action_requests set updated_at=clock_timestamp()-interval '16 minutes' where id=$1",
        [f.request.id]
      );
      expect(await f.repository.claimNext()).toBeNull();
      expect((await service().status(principal, f.receipt.executionId!)).state).toBe(
        admitted ? 'uncertain' : 'failed'
      );
      const delayed = await prepareQueuedRequest({
        request: f.request,
        runtime: { delegation: f.worker } as never,
        analytics: {} as never,
      });
      expect(delayed.persistence).toBe('observe_only');
    }
  );
  it('prevents stale heartbeat and admission after expiry before the next poll', async () => {
    const f = await claimed();
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '16 minutes' where id=$1",
      [f.request.id]
    );
    await f.repository.heartbeat(f.request.id);
    expect(
      (await f.worker.authorizeDelegatedRequest(f.request, false, decodeQueuedAction(f.request)))
        .kind
    ).not.toBe('new_execution');
    expect(
      (await pool.query('select started_at from mcp_executions')).rows[0].started_at
    ).toBeNull();
  });
  it('keeps all replay envelopes read-only and preserves a completed queue winner', async () => {
    const f = await claimed();
    await f.worker.authorizeDelegatedRequest(f.request, false, decodeQueuedAction(f.request));
    const replay = await prepareQueuedRequest({
      request: f.request,
      runtime: { delegation: f.worker } as never,
      analytics: {} as never,
    });
    expect(replay.persistence).toBe('observe_only');
    const winner = { action_type: 'clear_moderation_queue', queue_cleanup: { cleared: 3 } };
    await f.repository.complete(f.request.id, winner);
    await f.repository.fail(f.request.id, 'late error');
    await f.repository.complete(f.request.id, {
      action_type: 'delegated_admission',
      state: 'uncertain',
    });
    expect((await f.repository.findById(f.request.id))?.result).toEqual(winner);
  });
  it('allows the genuinely admitted owner to complete after interrupted settlement', async () => {
    const f = await claimed();
    await f.worker.authorizeDelegatedRequest(f.request, false, decodeQueuedAction(f.request));
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '16 minutes' where id=$1",
      [f.request.id]
    );
    await f.repository.claimNext();
    expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
    await f.repository.complete(f.request.id, {
      action_type: 'clear_moderation_queue',
      queue_cleanup: { cleared: 3 },
    });
    expect((await service().status(principal, f.receipt.executionId!)).state).toBe('completed');
  });
  it('charges new intents only on durable insertion and retains idempotency at the budget', async () => {
    const action = service();
    for (let i = 0; i < 20; i++)
      expect(
        (await action.submit(principal, { ...invocation, idempotencyKey: String(i) })).state
      ).toBe('confirmation_required');
    expect((await action.submit(principal, { ...invocation, idempotencyKey: 'extra' })).code).toBe(
      'rate_limited'
    );
    expect((await action.submit(principal, { ...invocation, idempotencyKey: '0' })).state).toBe(
      'confirmation_required'
    );
    expect(
      (
        await pool.query(
          "select cardinality(starts) as count from mcp_rate_buckets where category='new_intent' and subject=$1",
          ['connection:' + principal.connectionId]
        )
      ).rows[0].count
    ).toBe(20);
  });
  it('classifies real submissions, alternative approvals, cancellation, status and previews with safe audit', async () => {
    let enabled = true;
    const lines: string[] = [];
    const operations = {
      ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
      enabled: () => enabled,
      recordMcpAudit: createMcpAudit((line) => lines.push(line)),
    };
    const check = jest.spyOn(operations, 'checkMcpLimit');
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations,
    });
    const first = await action.submit(principal, invocation);
    const receipt = await action.confirm(principal, first.confirmationId!, 'website');
    await action.status(principal, receipt.executionId!);
    const cancelled = await action.submit(principal, { ...invocation, idempotencyKey: 'cancel' });
    await action.cancel(principal, cancelled.confirmationId!);
    const discord = await action.submit(principal, { ...invocation, idempotencyKey: 'discord' });
    await action.confirm(principal, discord.confirmationId!, 'discord');
    const preview = createDelegatedActionService({
      store,
      access,
      direct: { execute: jest.fn() },
      operations,
      resolver: {
        resolve: async () => ({
          delivery: { kind: 'queued', command: { kind: 'audit_case_role_lockdown' } },
          preconditions: { kind: 'none' },
          relevantState: {},
          summary: 'Audit role',
          previewExpiresAt: null,
        }),
      },
    });
    expect(
      (
        await preview.submit(principal, {
          ...invocation,
          workflowId: 'audit_case_role_lockdown',
          idempotencyKey: 'preview',
        })
      ).state
    ).toBe('queued');
    expect(check.mock.calls.map((call) => call[1])).toEqual([
      'submission',
      'submission',
      'read',
      'submission',
      'submission',
      'submission',
      'submission',
      'read',
    ]);
    for (const [subject] of check.mock.calls)
      expect(subject).toMatchObject({ ...principal, guildId: 'guild' });
    expect(lines.map((line) => JSON.parse(line))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ confirmationMethod: 'website', outcome: 'queued' }),
        expect.objectContaining({ confirmationMethod: 'discord', outcome: 'queued' }),
        expect.objectContaining({ outcome: 'cancelled' }),
      ])
    );
    enabled = false;
    expect(
      (await action.submit(principal, { ...invocation, idempotencyKey: 'disabled' })).code
    ).toBe('mcp_disabled');
    expect(check).toHaveBeenCalledTimes(8);
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ outcome: 'denied' });
    enabled = true;
    check.mockResolvedValueOnce({ kind: 'limited', retryAfterSeconds: 12 });
    expect(
      await action.submit(principal, { ...invocation, idempotencyKey: 'limited' })
    ).toMatchObject({ code: 'rate_limited', retryAfterMs: 12_000 });
    expect(JSON.parse(lines.at(-1)!)).toMatchObject({ outcome: 'limited' });
  });
  it('never charges an unauthorized target guild for public submissions', async () => {
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations: {
        ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
        enabled: () => true,
        recordMcpAudit: async () => {},
      },
    });
    expect((await action.submit(principal, { ...invocation, guildId: 'foreign' })).state).toBe(
      'denied'
    );
    expect(
      (await pool.query("select * from mcp_rate_buckets where subject='guild:foreign'")).rowCount
    ).toBe(0);
    expect(
      (
        await pool.query(
          "select cardinality(starts) as count from mcp_rate_buckets where category='submission' and subject=$1",
          ['connection:' + principal.connectionId]
        )
      ).rows[0].count
    ).toBe(1);
  });
  it.each(['unavailable', 'permission_denied'] as const)(
    'uses the same %s accounting decision for confirmation authorization',
    async (reason) => {
      const operations = {
        ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
        enabled: () => true,
        recordMcpAudit: async () => {},
      };
      const action = createDelegatedActionService({
        store,
        access,
        resolver,
        direct: { execute: jest.fn() },
        operations,
      });
      const intent = await action.submit(principal, invocation);
      const authorize = jest
        .spyOn(access, 'authorizeWorkflowId')
        .mockResolvedValueOnce({ kind: 'denied', reason });
      expect(await action.confirm(principal, intent.confirmationId!, 'website')).toMatchObject({
        state: 'denied',
        code: reason,
      });
      expect(authorize).toHaveBeenCalledTimes(1);
      expect(
        (
          await pool.query('select state from mcp_intents where confirmation_id=$1', [
            intent.confirmationId,
          ])
        ).rows[0].state
      ).toBe(reason === 'unavailable' ? 'pending' : 'denied');
      expect((await pool.query('select * from mcp_executions')).rowCount).toBe(0);
    }
  );
  it('keeps a rate-limited confirmation pending and retryable', async () => {
    const operations = {
      ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
      enabled: () => true,
      recordMcpAudit: async () => {},
    };
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations,
    });
    const intent = await action.submit(principal, invocation);
    jest
      .spyOn(operations, 'checkMcpLimit')
      .mockResolvedValueOnce({ kind: 'limited', retryAfterSeconds: 5 });
    expect(await action.confirm(principal, intent.confirmationId!, 'website')).toMatchObject({
      code: 'rate_limited',
      retryAfterMs: 5000,
    });
    expect(
      (
        await pool.query('select state from mcp_intents where confirmation_id=$1', [
          intent.confirmationId,
        ])
      ).rows[0].state
    ).toBe('pending');
    expect((await action.confirm(principal, intent.confirmationId!, 'website')).state).toBe(
      'queued'
    );
  });
  it('charges status from its own authorization and preserves ownership-only cancellation', async () => {
    const operations = {
      ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
      enabled: () => true,
      recordMcpAudit: async () => {},
    };
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations,
    });
    const intent = await action.submit(principal, invocation);
    const receipt = await action.confirm(principal, intent.confirmationId!, 'website');
    const cancel = await action.submit(principal, {
      ...invocation,
      idempotencyKey: 'cancel-owned',
    });
    authorityFacts = { ...authorityFacts, permissions: '0' };
    expect((await action.status(principal, receipt.executionId!)).code).toBe('permission_denied');
    expect(
      (
        await pool.query(
          "select * from mcp_rate_buckets where category='read' and subject='guild:guild'"
        )
      ).rowCount
    ).toBe(0);
    expect((await action.cancel(principal, cancel.confirmationId!)).code).toBe('cancelled');
    authorityFacts = { ...authorityFacts, permissions: '8' };
    expect((await action.status(principal, receipt.executionId!)).state).toBe('queued');
    expect(
      (
        await pool.query(
          "select cardinality(starts) as count from mcp_rate_buckets where category='read' and subject='guild:guild'"
        )
      ).rows[0].count
    ).toBe(1);
  });
  it('bounds cancellation before mutation when optional accounting context is unavailable', async () => {
    const operations = {
      ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
      enabled: () => true,
      recordMcpAudit: async () => {},
    };
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations,
    });
    const intent = await action.submit(principal, invocation);
    jest.spyOn(store, 'loadIntent').mockRejectedValueOnce(new Error('temporary context read'));
    jest
      .spyOn(operations, 'checkMcpLimit')
      .mockResolvedValueOnce({ kind: 'limited', retryAfterSeconds: 5 });
    expect((await action.cancel(principal, intent.confirmationId!)).code).toBe('rate_limited');
    expect(
      (
        await pool.query('select state from mcp_intents where confirmation_id=$1', [
          intent.confirmationId,
        ])
      ).rows[0].state
    ).toBe('pending');
  });
  it('omits denied saved guild context without bypassing durable confirmation denial', async () => {
    const action = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
      operations: {
        ...createMcpOperationalStore(createWebDelegationDatabase(pool)),
        enabled: () => true,
        recordMcpAudit: async () => {},
      },
    });
    const intent = await action.submit(principal, invocation);
    authorityFacts = { ...authorityFacts, permissions: '0' };
    const approvals = createAlternativeApprovals({
      store: createActorApprovalStore(createWebDelegationDatabase(pool)),
      access,
      service: action,
      checkRead: async (p, guildId) =>
        (
          await createMcpOperationalStore(createWebDelegationDatabase(pool)).checkMcpLimit(
            { ...p, ...(guildId ? { guildId } : {}) },
            'read'
          )
        ).kind === 'allowed',
    });
    await expect(approvals.load(principal.userId, intent.confirmationId!)).rejects.toThrow(
      'permission_denied'
    );
    expect(
      (
        await pool.query(
          "select * from mcp_rate_buckets where category='read' and subject='guild:guild'"
        )
      ).rowCount
    ).toBe(0);
    expect(
      (
        await pool.query('select state from mcp_intents where confirmation_id=$1', [
          intent.confirmationId,
        ])
      ).rows[0].state
    ).toBe('pending');
    expect((await action.confirm(principal, intent.confirmationId!, 'website')).state).toBe(
      'denied'
    );
    expect(
      (
        await pool.query(
          "select cardinality(starts) as count from mcp_rate_buckets where category='submission' and subject='guild:guild'"
        )
      ).rows[0].count
    ).toBe(1);
    expect(
      (
        await pool.query('select state from mcp_intents where confirmation_id=$1', [
          intent.confirmationId,
        ])
      ).rows[0].state
    ).toBe('denied');
    authorityFacts = { ...authorityFacts, permissions: '8' };
    expect((await action.confirm(principal, intent.confirmationId!, 'discord')).state).toBe(
      'denied'
    );
    expect((await pool.query('select * from mcp_executions')).rowCount).toBe(0);
  });
  it('prunes idle expired intents and buckets with a total cap and never cascades executions', async () => {
    const receipt = await accept();
    const idle = await service().submit(principal, { ...invocation, idempotencyKey: 'idle' });
    await pool.query(
      "update mcp_intents set created_at=created_at-interval '9 days',expires_at=expires_at-interval '9 days'"
    );
    // Even an inconsistent ephemeral state cannot cascade a linked execution.
    await pool.query(
      "update mcp_intents set state='cancelled' where confirmation_id=(select confirmation_id from mcp_executions where id=$1)",
      [receipt.executionId]
    );
    await pool.query(
      "insert into mcp_rate_buckets select 'old:'||n,'read',array[clock_timestamp()-interval '3 days'],clock_timestamp()-interval '2 days' from generate_series(1,501)n"
    );
    const ops = createMcpOperationalStore(createWebDelegationDatabase(pool));
    expect(await ops.pruneExpiredMcpData(new Date(), 900)).toBe(500);
    expect(
      (await pool.query('select * from mcp_executions where id=$1', [receipt.executionId])).rowCount
    ).toBe(1);
    expect(
      (
        await pool.query('select * from mcp_intents where confirmation_id=$1', [
          idle.confirmationId,
        ])
      ).rowCount
    ).toBe(0);
    expect(
      Number(
        (await pool.query("select count(*) from mcp_rate_buckets where subject like 'old:%'"))
          .rows[0].count
      )
    ).toBe(2);
  });
  it('gates new admission but preserves already admitted observations after flag changes', async () => {
    let enabled = true;
    const guardedStore = createDelegationStore(createWebDelegationDatabase(pool), {
      enabled: () => enabled,
    });
    const f = await claimed();
    const worker = createDelegatedWorkerAdmission({ store: guardedStore, access });
    enabled = false;
    const denied = await worker.authorizeDelegatedRequest(
      f.request,
      false,
      decodeQueuedAction(f.request)
    );
    expect(denied).toMatchObject({ kind: 'denied', code: 'mcp_disabled' });
    expect(
      (await pool.query('select started_at from mcp_executions')).rows[0].started_at
    ).toBeNull();
    enabled = true;
    const action = service();
    const intent = await action.submit(principal, { ...invocation, idempotencyKey: 'after-start' });
    const receipt = await action.confirm(principal, intent.confirmationId!, 'client_confirmation');
    const started = (await f.repository.claimNext())!;
    expect(
      (await worker.authorizeDelegatedRequest(started, false, decodeQueuedAction(started))).kind
    ).toBe('new_execution');
    enabled = false;
    expect(
      (await worker.authorizeDelegatedRequest(started, false, decodeQueuedAction(started))).kind
    ).toBe('already_bound');
    await f.repository.complete(started.id, {
      action_type: 'clear_moderation_queue',
      queue_cleanup: { cleared: 1 },
    });
    expect((await action.status(principal, receipt.executionId!)).state).toBe('completed');
  });
  it('honors both retention ages and keeps denied intents outside ephemeral cleanup', async () => {
    const now = new Date();
    for (const [key, state, days] of [
      ['old-cancelled', 'cancelled', 8],
      ['old-expired', 'expired', 8],
      ['young-cancelled', 'cancelled', 6],
      ['old-denied', 'denied', 8],
    ] as const) {
      const intent = await service().submit(principal, { ...invocation, idempotencyKey: key });
      await pool.query(
        'update mcp_intents set state=$2,created_at=$3::timestamptz,expires_at=$3::timestamptz where confirmation_id=$1',
        [intent.confirmationId, state, new Date(now.getTime() - days * 86400000)]
      );
    }
    await pool.query(
      "insert into mcp_rate_buckets(subject,category,starts,expires_at) values('old-bucket','read','{}',$1::timestamptz-interval '25 hours'),('young-bucket','read','{}',$1::timestamptz-interval '23 hours')",
      [now]
    );
    const ops = createMcpOperationalStore(createWebDelegationDatabase(pool));
    expect(await ops.pruneExpiredMcpData(now, 0)).toBe(0);
    expect(await ops.pruneExpiredMcpData(now, 500)).toBe(3);
    expect(
      (
        await pool.query('select idempotency_key from mcp_intents order by idempotency_key')
      ).rows.map((row) => row.idempotency_key)
    ).toEqual(['old-denied', 'young-cancelled']);
    expect(
      (
        await pool.query(
          "select subject from mcp_rate_buckets where subject in ('old-bucket','young-bucket')"
        )
      ).rows
    ).toEqual([{ subject: 'young-bucket' }]);
  });
  it('defers transient admission reads and preserves the queue without a denial', async () => {
    const receipt = await accept();
    const repository = new ModerationActionRequestRepository(getPrismaClient());
    const worker = createDelegatedWorkerAdmission({
      store,
      access: {
        ...access,
        authorizeWorkflow: async () => ({ kind: 'denied', reason: 'unavailable' }),
      },
    });
    const service = new ModerationActionRequestService(
      repository,
      { delegation: worker } as never,
      {} as never
    );
    await service.processPendingRequests();
    expect((await repository.findById(receipt.requestId!))?.status).toBe('processing');
    expect((await pool.query('select outcome from mcp_executions')).rows[0].outcome).toBeNull();
  });
  it('rechecks the live lease after asynchronous authority resolution', async () => {
    const f = await claimed();
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '14 minutes 59.8 seconds' where id=$1",
      [f.request.id]
    );
    const worker = createDelegatedWorkerAdmission({
      store,
      access: {
        ...access,
        authorizeWorkflow: async (...args) => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return access.authorizeWorkflow(...args);
        },
      },
    });
    expect(
      (await worker.authorizeDelegatedRequest(f.request, false, decodeQueuedAction(f.request))).kind
    ).toBe('denied');
    expect(
      (await pool.query('select started_at from mcp_executions')).rows[0].started_at
    ).toBeNull();
  });
  it('settles safely across two real pollers', async () => {
    const f = await claimed();
    await f.worker.authorizeDelegatedRequest(f.request, false, decodeQueuedAction(f.request));
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '16 minutes' where id=$1",
      [f.request.id]
    );
    const other = new ModerationActionRequestRepository(getPrismaClient());
    expect(await Promise.all([f.repository.claimNext(), other.claimNext()])).toEqual([null, null]);
    expect((await service().status(principal, f.receipt.executionId!)).state).toBe('uncertain');
  });
  it('serializes actual queue delay and original execution provenance safely', async () => {
    const f = await claimed();
    const lines: string[] = [];
    const { createMcpAudit } = await import('@drasil/application');
    const guarded = createDelegationStore(createWebDelegationDatabase(pool), {
      audit: createMcpAudit((line) => lines.push(line)),
    });
    await pool.query("update mcp_executions set created_at=created_at-interval '2 seconds'");
    await createDelegatedWorkerAdmission({ store: guarded, access }).authorizeDelegatedRequest(
      f.request,
      false,
      decodeQueuedAction(f.request)
    );
    const event = JSON.parse(lines[0]);
    expect(event).toMatchObject({
      userId: principal.userId,
      clientId: principal.clientId,
      connectionId: principal.connectionId,
      grantVersion: 1,
      workflowId: invocation.workflowId,
      confirmationMethod: 'client_confirmation',
      executionId: f.receipt.executionId,
      requestId: f.request.id,
      outcome: 'running',
    });
    expect(event.queueDelayMs).toBeGreaterThanOrEqual(2000);
    expect(lines[0]).not.toMatch(/commandDigest|preconditions|summary|token|headers/);
  });
  it.each(['update', 'readback', 'observation'] as const)(
    'never fabricates failure audit when the %s database operation fails',
    async (stage) => {
      const receipt = await accept();
      const prisma = getPrismaClient();
      const repository = new ModerationActionRequestRepository(prisma);
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'info')
        .mockImplementation((line) => lines.push(String(line)));
      let restore: (() => void) | undefined;
      const execute = jest.fn(async () => {
        if (stage === 'readback') {
          await repository.complete(receipt.requestId!, {
            action_type: 'clear_moderation_queue',
            server_id: 'guild',
            removed_count: 3,
          });
          const readback = jest
            .spyOn(repository, 'findById')
            .mockRejectedValueOnce(new Error('PRIVATE_READBACK_FAILURE'));
          restore = () => readback.mockRestore();
        } else {
          const query =
            stage === 'update'
              ? jest
                  .spyOn(prisma, '$queryRaw')
                  .mockRejectedValueOnce(new Error('PRIVATE_UPDATE_FAILURE'))
              : jest
                  .spyOn(prisma, '$queryRawUnsafe')
                  .mockRejectedValueOnce(new Error('PRIVATE_AUDIT_FAILURE'));
          restore = () => query.mockRestore();
        }
        throw new Error('PRIVATE_DISPATCH_ERROR');
      });
      try {
        const worker = new ModerationActionRequestService(
          repository,
          {
            delegation: createDelegatedWorkerAdmission({ store, access }),
            operationsRuntime: { forExecution: () => ({ execute }) },
            caseConfirmations: { recordVerified: jest.fn() },
          } as never,
          {} as never
        );
        if (stage !== 'observation')
          await expect(worker.processPendingRequests(1)).rejects.toThrow();
        else await expect(worker.processPendingRequests(1)).resolves.toBe(1);
        restore?.();
        expect(execute).toHaveBeenCalledTimes(1);
        expect((await repository.findById(receipt.requestId!))?.status).toBe(
          stage === 'update' ? 'processing' : stage === 'readback' ? 'completed' : 'failed'
        );
        expect(lines).toEqual([]);
        expect(
          (
            await pool.query('select outcome from mcp_executions where id=$1', [
              receipt.executionId,
            ])
          ).rows[0].outcome
        ).toBeNull();
      } finally {
        restore?.();
        log.mockRestore();
      }
    }
  );
  it.each([false, true])(
    'audits a generic dispatch exception without polling, preserving completed winner=%s',
    async (completed) => {
      const receipt = await accept();
      const repository = new ModerationActionRequestRepository(getPrismaClient());
      const winner = {
        action_type: 'clear_moderation_queue',
        server_id: 'guild',
        removed_count: 3,
      };
      const execute = jest.fn(async () => {
        if (completed) await repository.complete(receipt.requestId!, winner);
        throw new Error('PRIVATE_DISPATCH_ERROR Bearer SECRET');
      });
      const lines: string[] = [];
      const log = jest
        .spyOn(console, 'info')
        .mockImplementation((line) => lines.push(String(line)));
      try {
        const worker = new ModerationActionRequestService(
          repository,
          {
            delegation: createDelegatedWorkerAdmission({ store, access }),
            operationsRuntime: { forExecution: () => ({ execute }) },
            caseConfirmations: { recordVerified: jest.fn() },
          } as never,
          {} as never
        );
        await worker.processPendingRequests(1);
        expect(execute).toHaveBeenCalledTimes(1);
        const queue = await repository.findById(receipt.requestId!);
        expect(queue?.status).toBe(completed ? 'completed' : 'failed');
        if (completed) expect(queue?.result).toEqual(winner);
        const execution = (
          await pool.query(
            'select started_at,completed_at,outcome from mcp_executions where id=$1',
            [receipt.executionId]
          )
        ).rows[0];
        expect(execution.started_at).not.toBeNull();
        expect(execution.completed_at).toBeNull();
        expect(execution.outcome).toBeNull();
        expect(lines.map((line) => JSON.parse(line))).toContainEqual(
          expect.objectContaining({
            event: 'observation',
            outcome: completed ? 'completed' : 'uncertain',
            userId: principal.userId,
            clientId: principal.clientId,
            connectionId: principal.connectionId,
            grantVersion: principal.grantVersion,
            guildId: 'guild',
            workflowId: invocation.workflowId,
            confirmationMethod: 'client_confirmation',
            executionId: receipt.executionId,
            requestId: receipt.requestId,
          })
        );
        expect(lines.join('')).not.toMatch(/PRIVATE_DISPATCH_ERROR|Bearer|SECRET|last_error/);
      } finally {
        log.mockRestore();
      }
    }
  );
  it('settles past a full batch of protected report-ban claims without changing their receipts', async () => {
    await pool.query("insert into users(discord_id) values('target')");
    const repository = new ModerationActionRequestRepository(getPrismaClient());
    const worker = createDelegatedWorkerAdmission({ store, access });
    for (let index = 0; index < 51; index++) {
      // Populate historical admitted work through the real service; each group starts a new budget window.
      if (index % 17 === 0)
        await pool.query(
          "update mcp_rate_buckets set starts=array(select s-interval '61 seconds' from unnest(starts)s)"
        );
      const detection = (
        await pool.query(
          "insert into detection_events(server_id,user_id,detection_type,confidence,reasons) values('guild','target','user_report',1,'{}') returning id"
        )
      ).rows[0].id;
      const command = {
        kind: 'ban_observed_detection' as const,
        targetUserId: 'target',
        detectionEventId: detection,
        reason: null,
        subject: { kind: 'observed' as const },
      };
      const action = createDelegatedActionService({
        store,
        access,
        direct: { execute: jest.fn() },
        resolver: {
          resolve: async () => ({
            delivery: { kind: 'queued', command },
            preconditions: { kind: 'none' },
            relevantState: {},
            summary: 'Ban observed account',
            previewExpiresAt: null,
          }),
        },
      });
      const intent = await action.submit(principal, {
        workflowId: 'ban_observed_detection_observed',
        guildId: 'guild',
        idempotencyKey: `protected-${index}`,
        input: { targetUserId: 'target', detectionEventId: detection, reason: null },
      });
      expect(intent.state).toBe('confirmation_required');
      expect(
        (await action.confirm(principal, intent.confirmationId!, 'client_confirmation')).state
      ).toBe('queued');
      const request = (await repository.claimNext())!;
      expect(
        (await worker.authorizeDelegatedRequest(request, false, decodeQueuedAction(request))).kind
      ).toBe('new_execution');
      await pool.query(
        "update moderation_action_requests set metadata=metadata||'{\"report_ban_phase\":\"discord_confirmed\"}'::jsonb,result=jsonb_build_object('observed_ban_result',jsonb_build_object('status','banned_updates_pending','operationId',id)) where id=$1",
        [request.id]
      );
    }
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '20 minutes'"
    );
    const protectedRows = await pool.query('select * from moderation_action_requests order by id');
    const f = await claimed();
    await pool.query(
      "update moderation_action_requests set updated_at=clock_timestamp()-interval '16 minutes' where id=$1",
      [f.request.id]
    );
    expect(await repository.claimNext()).toBeNull();
    expect((await service().status(principal, f.receipt.executionId!)).state).toBe('failed');
    expect(
      (
        await pool.query(
          "select * from moderation_action_requests where action_type='ban_observed_detection' order by id"
        )
      ).rows
    ).toEqual(protectedRows.rows);
    expect(await repository.claimReportBanReconciliation(new Date())).toMatchObject({
      action_type: 'ban_observed_detection',
      status: 'processing',
    });
  }, 30_000);
});
