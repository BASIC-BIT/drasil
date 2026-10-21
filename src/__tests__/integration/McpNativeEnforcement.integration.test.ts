import { mockDeep } from 'jest-mock-extended';
import { PermissionsBitField } from 'discord.js';
import { createDelegatedCaseActions } from '../../application/adapters/delegatedCases';
import type { BotCaseDependencies } from '../../application/adapters/cases';
import { UserModerationService } from '../../services/UserModerationService';
import { createCaseConfirmationStore } from '../../application/context';
import { Pool } from 'pg';
import {
  createDelegatedAccess,
  resolveCasePreconditions,
  readCasePolicy,
  projectHumanOutcome,
  ActionDeniedError,
  createDelegatedActionService,
  type DelegatedPrincipal,
  type IntentResolver,
} from '@drasil/application';
import { createDelegationStore, createNativeEnforcementStore } from '@drasil/application/postgres';
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
  async function fixture(kind: 'ban_user' | 'kick_user' = 'ban_user') {
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
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    const delegation = createDelegatedWorkerAdmission({ store, access, native });
    return { native, store, service, principal, accepted, request, delegation, command };
  }
  function actualRuntime(
    f: Awaited<ReturnType<typeof fixture>>,
    provider: jest.Mock,
    path: 'member' | 'by_id' | 'kick' = 'member'
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
    const f = await fixture('kick_user');
    const provider = jest.fn();
    const runtime = actualRuntime(f, provider, 'by_id');
    const prepared = await prepareQueuedRequest({
      runtime: runtime as never,
      request: f.request,
      analytics: {} as never,
    });
    const result = await prepared.execute();
    expect(result).toMatchObject({ action_type: 'kick_user', succeeded: false });
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
});
