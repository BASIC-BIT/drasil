import { mockDeep } from 'jest-mock-extended';
import { PermissionsBitField } from 'discord.js';
import { createDelegatedCaseActions } from '../../application/adapters/delegatedCases';
import type { BotCaseDependencies } from '../../application/adapters/cases';
import { UserModerationService } from '../../services/UserModerationService';
import { createCaseConfirmationStore } from '../../application/context';
import { Pool } from 'pg';
import { getPrismaClient } from '../testDb';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import {
  decodeQueuedAction,
  createDelegatedAccess,
  resolveCasePreconditions,
  readCasePolicy,
  projectHumanOutcome,
  ActionDeniedError,
  createDelegatedActionService,
  type DelegatedPrincipal,
  type IntentResolver,
} from '@drasil/application';
import {
  createDelegationStore,
  createNativeEnforcementStore,
  type DelegationSqlValue,
} from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import { createDelegatedWorkerAdmission } from '../../application/adapters/delegation';
import { prepareQueuedRequest } from '../../application/requestRuntime';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('MCP native enforcement', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => pool.end());
  async function fixture(kind: 'ban_user' | 'kick_user' = 'ban_user', claim = true) {
    const database = createWebDelegationDatabase(pool);
    const store = createDelegationStore(database);
    const native = createNativeEnforcementStore(database);
    await pool.query("insert into servers (guild_id) values ('guild')");
    await pool.query("insert into users (discord_id) values ('target')");
    const grant = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes: ['drasil:read', 'drasil:moderate'],
    });
    const principal: DelegatedPrincipal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
    const access = createDelegatedAccess({
      store,
      authority: {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: false,
          permissions: '8',
          roleIds: [],
        }),
      },
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => ({ guildIds: ['guild'], nextCursor: null }),
      },
    });
    const command =
      kind === 'ban_user'
        ? {
            kind,
            targetUserId: 'target',
            reason: null,
            intent: 'native_action' as const,
            selectedMessage: null,
          }
        : { kind, targetUserId: 'target', reason: null, selectedMessage: null };
    const preconditions = await resolveCasePreconditions('guild', command, {
      settings: { loadFresh: async () => readCasePolicy({}) },
      repository: {
        findById: async () => null,
        findActive: async () => null,
        findDetection: async () => null,
      },
      selectedMessage: async () => null,
    });
    const resolver: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'queued', command },
        preconditions,
        relevantState: {},
        summary: 'Native moderation',
        previewExpiresAt: null,
      }),
    };
    const service = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
    });
    const pending = await service.submit(principal, {
      workflowId: kind,
      guildId: 'guild',
      idempotencyKey: 'native-key',
      input: { targetUserId: 'target', reason: null },
    });
    const accepted = await service.confirm(
      principal,
      pending.confirmationId!,
      'client_confirmation'
    );
    const repository = new ModerationActionRequestRepository(getPrismaClient());
    const request = claim
      ? (await repository.claimNext())!
      : (await pool.query('select * from moderation_action_requests')).rows[0];
    const delegation = createDelegatedWorkerAdmission({ store, access, native });
    return {
      database,
      native,
      store,
      service,
      principal,
      accepted,
      request,
      delegation,
      command,
      repository,
    };
  }
  function actualRuntime(
    f: Awaited<ReturnType<typeof fixture>>,
    provider: jest.Mock,
    path: 'member' | 'by_id' | 'kick' = 'member',
    lookupError?: unknown
  ) {
    const deps = mockDeep<BotCaseDependencies>();
    const confirmations = createCaseConfirmationStore();
    deps.configService.getServerConfig.mockResolvedValue({ settings: {} } as never);
    deps.verificationEventRepository.findByUserAndServer.mockResolvedValue([]);
    const actor = {
      id: 'actor',
      permissions: new PermissionsBitField(8n),
      roles: { cache: new Map() },
    };
    const user = { id: 'target', username: 'target', tag: 'target' };
    const guild = {
      id: 'guild',
      ownerId: 'other',
      roles: { fetch: async () => undefined },
      client: { users: { fetch: async () => user } },
      bans: { create: provider },
      members: {
        fetch: async (input: unknown) => {
          if (input === 'target') {
            if (lookupError) throw lookupError;
            if (path === 'by_id') throw { code: 10007 };
            return member;
          }
          return actor;
        },
        fetchMe: async () => actor,
      },
    };
    const member = { id: 'target', guild, user, ban: provider, kick: provider };
    deps.client.guilds.fetch.mockResolvedValue(guild as never);
    deps.client.users.fetch.mockResolvedValue({ id: 'actor' } as never);
    const service = new UserModerationService(
      mockDeep(),
      mockDeep(),
      mockDeep(),
      deps.verificationEventRepository,
      mockDeep(),
      mockDeep()
    );
    const caseDeps: BotCaseDependencies = {
      client: deps.client,
      configService: deps.configService,
      verificationEventRepository: deps.verificationEventRepository,
      detectionEventsRepository: deps.detectionEventsRepository,
      securityActionService: deps.securityActionService,
      userModerationService: service,
      confirmations: confirmations.confirmations,
      roleGateService: null,
    };
    return {
      delegation: f.delegation,
      caseConfirmations: confirmations,
      casesForExecution: (execution: Parameters<typeof f.native.start>[0]) =>
        createDelegatedCaseActions(caseDeps, execution, f.native),
    };
  }
  function worker(
    f: Awaited<ReturnType<typeof fixture>>,
    runtime: ReturnType<typeof actualRuntime>
  ) {
    return new ModerationActionRequestService(f.repository, runtime as never, mockDeep());
  }
  async function expire(f: Awaited<ReturnType<typeof fixture>>) {
    await pool.query(
      "update moderation_action_requests set updated_at=now()-interval '16 minutes' where id=$1::uuid",
      [f.request.id]
    );
  }
  it.each(['uncertain', 'partial', 'completed'] as const)(
    'refreshes an absent-fence status snapshot after the native owner reaches %s',
    async (expectedState) => {
      const f = await fixture();
      const send = jest.fn(async () => {
        if (expectedState === 'uncertain')
          throw new Error('provider accepted; acknowledgement lost');
      });
      const runtime = actualRuntime(f, send);
      const owner = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: mockDeep(),
      });
      let observed!: () => void;
      let resume!: () => void;
      const absentFenceObserved = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const resumeStatus = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const query = f.database.query;
      let pauseNextFenceRead = true;
      jest
        .spyOn(f.database, 'query')
        .mockImplementation(
          async <Row extends Record<string, unknown>>(
            sql: string,
            values?: readonly DelegationSqlValue[]
          ): Promise<{ rows: Row[] }> => {
            const result = await query<Row>(sql, values);
            if (
              pauseNextFenceRead &&
              sql.startsWith('select acknowledged_at from mcp_native_enforcements')
            ) {
              pauseNextFenceRead = false;
              expect(result.rows).toHaveLength(0);
              observed();
              await resumeStatus;
            }
            return result;
          }
        );
      const status = f.service.status(f.principal, f.accepted.executionId!);
      await absentFenceObserved;
      try {
        const outcome = await owner.execute();
        expect(send).toHaveBeenCalledTimes(1);
        await expire(f);
        await worker(f, runtime).processPendingRequests();
        expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
        if (expectedState === 'completed') await f.repository.complete(f.request.id, outcome);
      } finally {
        resume();
      }
      const receipt = await status;
      expect(receipt.state).toBe(expectedState);
      expect(receipt.code).not.toBe('execution_interrupted_before_send');
      if (expectedState === 'completed') expect(receipt.outcome).toMatchObject({ succeeded: true });
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
  it.each(['ban_user', 'kick_user'] as const)(
    'settles expired unadmitted %s claims and rejects a stale owner',
    async (kind) => {
      const f = await fixture(kind);
      const send = jest.fn();
      const runtime = actualRuntime(f, send);
      await expire(f);
      expect(await worker(f, runtime).processPendingRequests()).toBe(0);
      expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
      expect((await f.service.status(f.principal, f.accepted.executionId!)).state).toBe('failed');
      const stale = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: mockDeep(),
      });
      expect(await stale.execute()).toMatchObject({ state: 'denied' });
      expect(send).not.toHaveBeenCalled();
    }
  );
  it('does not revive an expired native claim through a stale heartbeat', async () => {
    const f = await fixture();
    await expire(f);
    await f.repository.heartbeat(f.request.id);
    const send = jest.fn();
    const stale = await prepareQueuedRequest({
      runtime: actualRuntime(f, send) as never,
      request: f.request,
      analytics: mockDeep(),
    });
    expect(await stale.execute()).toMatchObject({ state: 'denied' });
    expect(send).not.toHaveBeenCalled();
    await worker(f, actualRuntime(f, send)).processPendingRequests();
    expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
  });
  it('rejects an expired unadmitted owner even before the next poll settles its claim', async () => {
    const f = await fixture();
    await expire(f);
    const send = jest.fn();
    const stale = await prepareQueuedRequest({
      runtime: actualRuntime(f, send) as never,
      request: f.request,
      analytics: mockDeep(),
    });
    expect(await stale.execute()).toMatchObject({ state: 'denied' });
    expect(send).not.toHaveBeenCalled();
  });
  it('denies a live native claim after connection revocation before admission', async () => {
    const f = await fixture('ban_user', false);
    await f.store.revokeConnection(f.principal, f.principal.grantVersion);
    const send = jest.fn();
    await worker(f, actualRuntime(f, send)).processPendingRequests();
    expect((await f.repository.findById(f.request.id))?.result).toMatchObject({ state: 'denied' });
    expect(send).not.toHaveBeenCalled();
  });
  it('settles expired pre-admission work after revocation without sending', async () => {
    const f = await fixture();
    await f.store.revokeConnection(f.principal, f.principal.grantVersion);
    await expire(f);
    const send = jest.fn();
    await worker(f, actualRuntime(f, send)).processPendingRequests();
    expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
    const stale = await prepareQueuedRequest({
      runtime: actualRuntime(f, send) as never,
      request: f.request,
      analytics: mockDeep(),
    });
    expect(await stale.execute()).toMatchObject({ state: 'denied' });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'prevents a paused admitted owner from sending after lease expiry (settled=%s)',
    async (settled) => {
      const f = await fixture();
      const send = jest.fn();
      const runtime = actualRuntime(f, send);
      const paused = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: mockDeep(),
      });
      await expire(f);
      if (settled) await worker(f, runtime).processPendingRequests();
      await paused.execute();
      expect(send).not.toHaveBeenCalled();
      await worker(f, runtime).processPendingRequests();
      expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
      expect(await f.native.reconcileNativeEnforcement(f.accepted.executionId!)).toMatchObject({
        state: 'failed',
        code: 'execution_interrupted_before_send',
      });
    }
  );
  it.each([false, true])(
    'settles expired fenced work without resending (acknowledged=%s)',
    async (acknowledged) => {
      const f = await fixture();
      const send = jest.fn();
      const runtime = actualRuntime(f, send);
      await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: mockDeep(),
      });
      const execution = (await f.store.loadExecution(f.principal, f.accepted.executionId!))!;
      const token = await f.native.start(execution);
      send();
      if (acknowledged) await f.native.acknowledge(execution.executionId, token);
      await f.store.revokeConnection(f.principal, f.principal.grantVersion);
      await expire(f);
      await worker(f, runtime).processPendingRequests();
      expect((await f.repository.findById(f.request.id))?.status).toBe('failed');
      expect(await f.native.reconcileNativeEnforcement(execution.executionId)).toMatchObject({
        state: acknowledged ? 'partial' : 'uncertain',
      });
      const observer = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: mockDeep(),
      });
      expect(observer.persistence).toBe('observe_only');
      await observer.execute();
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
  it('allows a late fenced winner to complete after expiry and a competing worker poll', async () => {
    const f = await fixture('ban_user', false);
    let release!: () => void;
    let sent!: () => void;
    const sending = new Promise<void>((resolve) => {
      sent = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const send = jest.fn(async () => {
      sent();
      await gate;
    });
    const runtime = actualRuntime(f, send);
    const winner = worker(f, runtime).processPendingRequests(1);
    await sending;
    await expire(f);
    await worker(f, runtime).processPendingRequests();
    const expired = await f.repository.findById(f.request.id);
    release();
    await winner;
    expect(expired?.status).toBe('failed');
    expect((await f.repository.findById(f.request.id))?.status).toBe('completed');
    expect(await f.service.status(f.principal, f.accepted.executionId!)).toMatchObject({
      state: 'completed',
      outcome: { succeeded: true },
    });
    await expire(f);
    await worker(f, runtime).processPendingRequests();
    expect((await f.repository.findById(f.request.id))?.status).toBe('completed');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('preserves a successful durable completion when the real service completion hook rejects', async () => {
    const f = await fixture('ban_user', false);
    const send = jest.fn();
    const runtime = actualRuntime(f, send);
    runtime.delegation = {
      ...runtime.delegation,
      complete: jest.fn().mockRejectedValue(new Error('completion database unavailable')),
    };
    await worker(f, runtime).processPendingRequests();
    expect(runtime.delegation.complete).toHaveBeenCalled();
    expect((await f.repository.findById(f.request.id))?.status).toBe('completed');
    expect(await f.service.status(f.principal, f.accepted.executionId!)).toMatchObject({
      state: 'completed',
      outcome: { succeeded: true },
    });
    expect(await f.native.reconcileNativeEnforcement(f.accepted.executionId!)).toMatchObject({
      state: 'completed',
      outcome: { succeeded: true },
    });
    await worker(f, runtime).processPendingRequests();
    await f.repository.fail(f.request.id, 'late stale failure');
    expect((await f.repository.findById(f.request.id))?.status).toBe('completed');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each([new Error('member lookup timeout'), { status: 503 }])(
    'does not complete a native kick as a no-op after a transient member lookup error: %p',
    async (error) => {
      const f = await fixture('kick_user', false);
      const send = jest.fn();
      await worker(f, actualRuntime(f, send, 'kick', error)).processPendingRequests();
      const receipt = await f.service.status(f.principal, f.accepted.executionId!);
      expect(receipt).toMatchObject({ state: 'failed', code: 'execution_interrupted_before_send' });
      expect(send).not.toHaveBeenCalled();
      expect((await pool.query('select * from mcp_native_enforcements')).rows).toHaveLength(0);
    }
  );
  it('does not repeat enforcement after a lost provider acknowledgement', async () => {
    const f = await fixture();
    const discordBan = jest.fn(async () => {
      throw new Error('timeout after Discord accepted ban');
    });
    const runtime = actualRuntime(f, discordBan);
    const first = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    await first.execute();
    const second = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    await second.execute();
    const receipt = await f.service.status(f.principal, f.accepted.executionId!);
    expect(discordBan).toHaveBeenCalledTimes(1);
    expect(receipt.state).toBe('uncertain');
  });
  it.each(['ban_user', 'kick_user'] as const)(
    'preserves acknowledged %s despite interrupted bookkeeping and never sends again',
    async (kind) => {
      const f = await fixture(kind);
      const send = jest.fn();
      const runtime = {
        delegation: f.delegation,
        caseConfirmations: { recordVerified: jest.fn() },
        casesForExecution: (execution: Parameters<typeof f.native.start>[0]) => ({
          execute: async () => {
            const token = await f.native.start(execution);
            send();
            await f.native.acknowledge(execution.executionId, token);
            throw new Error('bookkeeping interrupted');
          },
        }),
      };
      const first = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: {} as never,
      });
      expect(await first.execute()).toMatchObject({ state: 'partial' });
      const second = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: {} as never,
      });
      expect(await second.execute()).toMatchObject({ state: 'partial' });
      expect(send).toHaveBeenCalledTimes(1);
      expect((await f.service.status(f.principal, f.accepted.executionId!)).state).toBe('partial');
    }
  );
  it('preserves a completed native receipt on a later worker attempt', async () => {
    const f = await fixture();
    const send = jest.fn();
    const runtime = {
      delegation: f.delegation,
      caseConfirmations: { recordVerified: jest.fn() },
      casesForExecution: (execution: Parameters<typeof f.native.start>[0]) => ({
        execute: async () => {
          const token = await f.native.start(execution);
          send();
          await f.native.acknowledge(execution.executionId, token);
          return { kind: 'outcome', outcome: { kind: 'ban_user', succeeded: true } };
        },
      }),
    };
    const first = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    const result = await first.execute();
    await f.store.completeExecution(
      f.accepted.executionId!,
      projectHumanOutcome(f.command, result)
    );
    const second = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    expect(projectHumanOutcome(f.command, await second.execute()).state).toBe('completed');
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('survives process loss between start and provider acknowledgement with an exclusive fence', async () => {
    const f = await fixture();
    const execution = (await f.store.loadExecution(f.principal, f.accepted.executionId!))!;
    await f.delegation.authorizeDelegatedRequest(
      f.request,
      false,
      (await import('@drasil/application')).decodeQueuedAction(f.request)
    );
    const starts = await Promise.allSettled([f.native.start(execution), f.native.start(execution)]);
    expect(starts.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const receipt = await f.native.reconcileNativeEnforcement(execution.executionId);
    expect(receipt.state).toBe('uncertain');
    expect(JSON.stringify(receipt)).not.toContain('token');
    expect(receipt.summary).toContain('fresh intent');
  });

  it('never changes an ambiguous provider send into a definitive domain denial', async () => {
    const f = await fixture();
    const runtime = {
      delegation: f.delegation,
      caseConfirmations: { recordVerified: jest.fn() },
      casesForExecution: (execution: Parameters<typeof f.native.start>[0]) => ({
        execute: async () => {
          await f.native.start(execution);
          throw new ActionDeniedError('late_denial');
        },
      }),
    };
    const prepared = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    expect(await prepared.execute()).toMatchObject({ state: 'uncertain' });
  });
  it('denies before the provider fence without claiming an external effect', async () => {
    const f = await fixture();
    const runtime = {
      delegation: f.delegation,
      caseConfirmations: { recordVerified: jest.fn() },
      casesForExecution: () => ({
        execute: async () => {
          throw new ActionDeniedError('bot_permission_denied');
        },
      }),
    };
    const prepared = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    expect(await prepared.execute()).toMatchObject({
      state: 'denied',
      code: 'bot_permission_denied',
    });
    expect((await pool.query('select * from mcp_native_enforcements')).rows).toHaveLength(0);
  });
  it('uses the durable completed queue result after acknowledged send and process loss before completion hook', async () => {
    const f = await fixture();
    const execution = (await f.store.loadExecution(f.principal, f.accepted.executionId!))!;
    await f.delegation.authorizeDelegatedRequest(
      f.request,
      false,
      (await import('@drasil/application')).decodeQueuedAction(f.request)
    );
    const token = await f.native.start(execution);
    await f.native.acknowledge(execution.executionId, token);
    await pool.query(
      "update moderation_action_requests set status='completed',result=$2::jsonb where id=$1::uuid",
      [f.request.id, JSON.stringify({ action_type: 'ban_user', succeeded: true })]
    );
    expect((await f.service.status(f.principal, execution.executionId)).state).toBe('completed');
  });

  it.each(['by_id', 'kick'] as const)(
    'does not repeat actual %s enforcement after timeout',
    async (path) => {
      const f = await fixture(path === 'kick' ? 'kick_user' : 'ban_user');
      const provider = jest.fn(async () => {
        throw new Error('provider accepted then timeout');
      });
      const runtime = actualRuntime(f, provider, path);
      const first = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: {} as never,
      });
      await first.execute();
      const second = await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: {} as never,
      });
      await second.execute();
      expect(provider).toHaveBeenCalledTimes(1);
      expect((await f.service.status(f.principal, f.accepted.executionId!)).state).toBe(
        'uncertain'
      );
    }
  );
  it('returns an honest kick no-op for an absent member without entering the send fence', async () => {
    const f = await fixture('kick_user', false);
    const provider = jest.fn();
    await worker(f, actualRuntime(f, provider, 'by_id')).processPendingRequests();
    expect(await f.service.status(f.principal, f.accepted.executionId!)).toMatchObject({
      state: 'completed',
      outcome: { succeeded: false },
    });
    expect(provider).not.toHaveBeenCalled();
    expect((await pool.query('select * from mcp_native_enforcements')).rows).toHaveLength(0);
  });
  it('requires a fresh key and intent for an intentional attempt after uncertainty', async () => {
    const f = await fixture();
    const provider = jest.fn(async () => {
      throw new Error('lost acknowledgement');
    });
    const runtime = actualRuntime(f, provider);
    await (
      await prepareQueuedRequest({
        runtime: runtime as never,
        request: f.request,
        analytics: {} as never,
      })
    ).execute();
    const invocation = {
      workflowId: 'ban_user' as const,
      guildId: 'guild',
      idempotencyKey: 'native-key',
      input: { targetUserId: 'target', reason: null },
    };
    expect((await f.service.submit(f.principal, invocation)).state).toBe('uncertain');
    const fresh = await f.service.submit(f.principal, {
      ...invocation,
      idempotencyKey: 'intentional-second-attempt',
    });
    expect(fresh.state).toBe('confirmation_required');
    const accepted = await f.service.confirm(
      f.principal,
      fresh.confirmationId!,
      'client_confirmation'
    );
    expect(accepted.executionId).not.toBe(f.accepted.executionId);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it('keeps native enforcement fencing state behind the private MCP database boundary', async () => {
    const relation = await pool.query<{ relrowsecurity: boolean }>(
      "select relrowsecurity from pg_class where oid='public.mcp_native_enforcements'::regclass"
    );
    expect(relation.rows[0].relrowsecurity).toBe(true);
    const publicPrivileges = await pool.query(
      "select 1 from pg_class c, lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where c.oid='public.mcp_native_enforcements'::regclass and a.grantee=0"
    );
    expect(publicPrivileges.rows).toHaveLength(0);
  });
  it('checks the enable flag at the actual native send fence after generic admission', async () => {
    const f = await fixture();
    const admission = await f.delegation.authorizeDelegatedRequest(
      f.request,
      false,
      decodeQueuedAction(f.request)
    );
    if (admission.kind !== 'new_execution') throw new Error('Expected admission');
    let enabled = false;
    const native = createNativeEnforcementStore(f.database, () => enabled);
    await expect(native.start(admission.execution)).rejects.toThrow('mcp_disabled');
    expect((await pool.query('select * from mcp_native_enforcements')).rowCount).toBe(0);
    enabled = true;
    const token = await native.start(admission.execution);
    enabled = false;
    await native.acknowledge(admission.execution.executionId, token);
    expect((await native.reconcileNativeEnforcement(admission.execution.executionId)).state).toBe(
      'partial'
    );
  });
});
