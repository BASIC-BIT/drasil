import { mockDeep } from 'jest-mock-extended';
import type { Client } from 'discord.js';
import type { IConfigService } from '../../config/ConfigService';
import { getPrismaClient } from '../testDb';
import {
  createBotDelegatedRuntime,
  createDelegatedWorkerAdmission,
} from '../../application/adapters/delegation';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { prepareQueuedRequest } from '../../application/requestRuntime';
import {
  createReportResources,
  createDelegationStore,
  createReportReviewReferenceStore,
} from '@drasil/application/postgres';
import {
  prepareSubmittedReportCaseOpen,
  createIntentService,
  createDelegatedActionService,
  type DelegatedPrincipal,
  type IntentResolver,
  type DelegatedAccess,
  type HumanCommand,
} from '@drasil/application';
import { Pool } from 'pg';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('MCP report durable choices', () => {
  const previousEnabled = process.env.DRASIL_MCP_ENABLED;
  let pool: Pool;
  let principal: DelegatedPrincipal;
  let store: ReturnType<typeof createDelegationStore>;
  const access = {
    authorizeWorkflowId: async () => ({ kind: 'allowed' }),
    authorizeWorkflow: async () => ({ kind: 'allowed' }),
    authorizeRead: async () => ({ kind: 'allowed' }),
  } as unknown as DelegatedAccess;
  beforeAll(() => {
    process.env.DRASIL_MCP_ENABLED = 'true';
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => {
    try {
      await pool.end();
    } finally {
      if (previousEnabled === undefined) delete process.env.DRASIL_MCP_ENABLED;
      else process.env.DRASIL_MCP_ENABLED = previousEnabled;
    }
  });
  beforeEach(async () => {
    await pool.query("insert into servers(guild_id) values('guild')");
    await pool.query("insert into users(discord_id) values ('target')");
    store = createDelegationStore(createWebDelegationDatabase(pool));
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
  });
  function terminal(): IntentResolver {
    return {
      resolve: async () => ({
        delivery: {
          kind: 'report_case_terminal',
          outcome: {
            actor: { id: 'actor', surface: 'mcp' },
            action: 'open_case',
            reportId: 'report',
            status: 'busy',
            caseId: null,
            targetUserId: null,
            detectionEventId: null,
            queueCleanupStatus: 'skipped',
          },
        },
        preconditions: { kind: 'none' },
        relevantState: { busy: true },
        summary: 'Report busy',
        previewExpiresAt: null,
      }),
    };
  }
  it('durably accepts concurrent report no-ops once without direct or queue effects', async () => {
    const direct = { execute: jest.fn() };
    const service = createDelegatedActionService({ store, access, resolver: terminal(), direct });
    const invocation = {
      workflowId: 'open_submitted_report_case' as const,
      guildId: 'guild',
      idempotencyKey: 'noop',
      input: { reportId: 'report' },
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.submit(principal, invocation))
    );
    for (const result of results)
      expect(result).toMatchObject({ state: 'completed', outcome: { status: 'busy' } });
    expect(new Set(results.map((r) => ('executionId' in r ? r.executionId : null))).size).toBe(1);
    expect(direct.execute).not.toHaveBeenCalled();
    expect(
      (await pool.query('select count(*)::int as n from moderation_action_requests')).rows[0].n
    ).toBe(0);
    expect((await pool.query('select count(*)::int as n from mcp_executions')).rows[0].n).toBe(1);
  });
  it('denies no-op to ready changes at acceptance without creating a queue child', async () => {
    const initial = terminal();
    const service = createIntentService({ store, access, resolver: initial });
    const intent = await service.prepareIntent(principal, {
      workflowId: 'open_submitted_report_case',
      guildId: 'guild',
      idempotencyKey: 'noop',
      input: { reportId: 'report' },
    });
    initial.resolve = async () => ({
      delivery: {
        kind: 'queued',
        command: {
          kind: 'open_case_from_observed_detection',
          reportId: 'report',
          detectionEventId: 'detection',
          targetUserId: 'target',
        },
      },
      preconditions: { kind: 'none' },
      relevantState: { busy: false },
      summary: 'Ready',
      previewExpiresAt: null,
    });
    await expect(
      service.acceptWithoutConfirmation(principal, intent.confirmationId)
    ).rejects.toThrow('stale_state');
    expect(
      (await pool.query('select count(*)::int as n from moderation_action_requests')).rows[0].n
    ).toBe(0);
  });
  async function execution(
    command: Extract<
      HumanCommand,
      { kind: 'prepare_report_ban_review' | 'review_uncertain_report_ban' }
    >,
    key: string,
    expiresAt: Date,
    start = true
  ) {
    const resolver: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'queued', command },
        preconditions:
          command.kind === 'review_uncertain_report_ban'
            ? {
                kind: 'report_ban_review',
                operationId: command.operationId,
                reviewReference: command.reviewReference,
                expiresAt,
              }
            : { kind: 'none' },
        relevantState: {},
        summary: 'Review',
        previewExpiresAt: command.kind === 'review_uncertain_report_ban' ? expiresAt : null,
      }),
    };
    const service = createIntentService({ store, access, resolver });
    const { kind, ...input } = command;
    const intent = await service.prepareIntent(principal, {
      workflowId: kind,
      guildId: 'guild',
      idempotencyKey: key,
      input,
    });
    const result =
      kind === 'prepare_report_ban_review'
        ? await service.acceptWithoutConfirmation(principal, intent.confirmationId)
        : await service.acceptIntent(principal, intent.confirmationId, 'client_confirmation');
    if (start)
      await pool.query('update mcp_executions set started_at=clock_timestamp() where id=$1', [
        result.executionId,
      ]);
    return result;
  }
  it('loads and claims a durable preparation after the real service completion hook fails', async () => {
    const refs = createReportReviewReferenceStore(createWebDelegationDatabase(pool));
    const expires = new Date(Date.now() + 600000);
    const prepare = await execution(
      { kind: 'prepare_report_ban_review', operationId: 'operation' },
      'prepare',
      expires,
      false
    );
    const prepareReference = jest.fn(async () => {
      const saved = await refs.save(prepare.executionId, {
        operationId: 'operation',
        targetUserId: 'target',
        attemptToken: 'PRIVATE-TOKEN',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      return {
        kind: 'outcome',
        outcome: {
          kind: 'prepare_report_ban_review',
          reference: { ...saved, expiresAt: saved.expiresAt.toISOString() },
        },
      };
    });
    const complete = jest.fn().mockRejectedValue(new Error('completion bookkeeping unavailable'));
    const repository = new ModerationActionRequestRepository(getPrismaClient());
    const worker = new ModerationActionRequestService(
      repository,
      {
        delegation: { ...createDelegatedWorkerAdmission({ store, access }), complete },
        detectionRuntime: { forRequest: () => ({ execute: prepareReference }) },
        caseConfirmations: { recordVerified: jest.fn() },
      } as never,
      mockDeep()
    );
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await worker.processPendingRequests();
    } finally {
      warn.mockRestore();
    }
    expect(complete).toHaveBeenCalledTimes(1);
    expect(prepareReference).toHaveBeenCalledTimes(1);
    expect(await worker.processPendingRequests()).toBe(0);
    expect(prepareReference).toHaveBeenCalledTimes(1);
    const queue = (
      await pool.query('select status,result from moderation_action_requests where id=$1', [
        prepare.queueRequestId,
      ])
    ).rows[0];
    expect(queue.status).toBe('completed');
    expect(
      (
        await pool.query('select completed_at from mcp_executions where id=$1', [
          prepare.executionId,
        ])
      ).rows[0].completed_at
    ).toBeNull();
    const reference = {
      operationId: 'operation',
      targetUserId: 'target',
      reviewReference: prepare.executionId,
      expiresAt: new Date(queue.result.expiresAt),
    };
    const restarted = createReportReviewReferenceStore(createWebDelegationDatabase(pool));
    for (const foreign of [
      { ...principal, userId: 'other' },
      { ...principal, clientId: 'other' },
      { ...principal, connectionId: '00000000-0000-4000-8000-000000000001' },
      { ...principal, grantVersion: principal.grantVersion + 1 },
    ])
      expect(await restarted.load(foreign, 'guild', reference.reviewReference)).toBeNull();
    expect(await restarted.load(principal, 'other', reference.reviewReference)).toBeNull();
    expect(await restarted.load(principal, 'guild', reference.reviewReference)).toEqual(reference);
    expect(await store.loadExecution(principal, prepare.executionId)).toMatchObject({
      outcome: {
        result: {
          state: 'completed',
          outcome: { details: { reviewReference: prepare.executionId } },
        },
      },
    });
    expect(JSON.stringify(await store.loadExecution(principal, prepare.executionId))).not.toContain(
      'PRIVATE-TOKEN'
    );
    const command = {
      kind: 'review_uncertain_report_ban' as const,
      operationId: 'operation',
      targetUserId: 'target',
      reviewReference: reference.reviewReference,
      reason: 'No current ban',
    };
    const first = await execution(command, 'review1', reference.expiresAt),
      second = await execution(command, 'review2', reference.expiresAt);
    for (const invalid of [
      { status: 'processing', result: queue.result },
      { status: 'failed', result: queue.result },
      { status: 'completed', result: {} },
      {
        status: 'completed',
        result: { ...queue.result, action_type: 'delegated_admission', state: 'denied' },
      },
      { status: 'completed', result: { ...queue.result, reviewReference: first.executionId } },
      { status: 'completed', result: { ...queue.result, operationId: 'other' } },
      { status: 'completed', result: { ...queue.result, targetUserId: 'other' } },
    ]) {
      await pool.query(
        'update moderation_action_requests set status=$2::moderation_action_request_status,result=$3::jsonb where id=$1',
        [prepare.queueRequestId, invalid.status, JSON.stringify(invalid.result)]
      );
      expect(await restarted.load(principal, 'guild', reference.reviewReference)).toBeNull();
      expect(await restarted.claim(first.executionId, reference.reviewReference)).toBeNull();
    }
    await pool.query(
      "update moderation_action_requests set status='completed',result=$2::jsonb where id=$1",
      [prepare.queueRequestId, JSON.stringify(queue.result)]
    );
    const claims = await Promise.all([
      restarted.claim(first.executionId, reference.reviewReference),
      restarted.claim(second.executionId, reference.reviewReference),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.find(Boolean)).toMatchObject({
      attemptToken: 'PRIVATE-TOKEN',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(await restarted.claim(first.executionId, reference.reviewReference)).toBeNull();
    expect(await restarted.load(principal, 'guild', reference.reviewReference)).toBeNull();
    const metadata = (
      await pool.query('select metadata from moderation_action_requests where id=$1', [
        prepare.queueRequestId,
      ])
    ).rows[0].metadata;
    expect(metadata.delegation.executionId).toBe(prepare.executionId);
  });
  it('consumes an expired reference before returning a denial', async () => {
    const refs = createReportReviewReferenceStore(createWebDelegationDatabase(pool));
    const prepare = await execution(
      { kind: 'prepare_report_ban_review', operationId: 'operation' },
      'prepare',
      new Date(Date.now() + 600000)
    );
    const ref = await refs.save(prepare.executionId, {
      operationId: 'operation',
      targetUserId: 'target',
      attemptToken: 'secret',
      updatedAt: new Date(),
    });
    await pool.query(
      "update moderation_action_requests set status='completed',result=$2::jsonb where id=$1",
      [
        prepare.queueRequestId,
        JSON.stringify({
          action_type: 'prepare_report_ban_review',
          operationId: 'operation',
          targetUserId: 'target',
          reviewReference: ref.reviewReference,
          expiresAt: ref.expiresAt.toISOString(),
        }),
      ]
    );
    await store.completeExecution(prepare.executionId, { state: 'completed' });
    const review = await execution(
      {
        kind: 'review_uncertain_report_ban',
        operationId: 'operation',
        targetUserId: 'target',
        reviewReference: ref.reviewReference,
        reason: 'No current ban',
      },
      'review',
      ref.expiresAt
    );
    await pool.query(
      "update moderation_action_requests set metadata=jsonb_set(metadata,'{mcp_report_review_private,expiresAt}','\"2000-01-01T00:00:00.000Z\"'::jsonb) where id=$1",
      [prepare.queueRequestId]
    );
    expect(await refs.claim(review.executionId, ref.reviewReference)).toBeNull();
    expect(
      (
        await pool.query(
          "select metadata->'mcp_report_review_private'->>'consumedBy' as consumer from moderation_action_requests where id=$1",
          [prepare.queueRequestId]
        )
      ).rows[0].consumer
    ).toBe(review.executionId);
  });

  it.each([true, false])(
    'rechecks actual report candidate through the admitted worker (stale=%s)',
    async (stale) => {
      await pool.query("insert into users(discord_id) values('actor')");
      const report = (
        await pool.query(
          "insert into report_intakes(server_id,reporter_id,status,confirmed_target_user_id) values('guild','actor','submitted','target') returning id"
        )
      ).rows[0].id;
      await getPrismaClient().detection_events.create({
        data: {
          server_id: 'guild',
          user_id: 'target',
          detection_type: 'user_report',
          confidence: 1,
          metadata: { reportIntakeId: report },
        },
      });
      const facts = {
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: false,
        permissions: '32',
        roleIds: [],
      };
      const preparation = await prepareSubmittedReportCaseOpen(
        {
          guildId: 'guild',
          requestId: 'prepare',
          source: 'mcp',
          actor: { kind: 'user', userId: 'actor' },
        },
        { reportId: report },
        {
          authority: { loadFresh: async () => facts },
          openCaseRepository: createReportResources(createWebDelegationDatabase(pool))
            .openCaseRepository,
        }
      );
      if (preparation.kind !== 'ready') throw new Error('Not ready');
      const resolver: IntentResolver = {
        resolve: async () => ({
          delivery: { kind: 'queued', command: preparation.command },
          preconditions: preparation.precondition,
          relevantState: preparation.precondition,
          summary: 'Open report case',
          previewExpiresAt: null,
        }),
      };
      const service = createIntentService({ store, access, resolver });
      const intent = await service.prepareIntent(principal, {
        workflowId: 'open_submitted_report_case',
        guildId: 'guild',
        idempotencyKey: 'case',
        input: { reportId: report },
      });
      const accepted = await service.acceptIntent(
        principal,
        intent.confirmationId,
        'client_confirmation'
      );
      expect((await new ModerationActionRequestRepository(getPrismaClient()).claimNext())?.id).toBe(
        accepted.queueRequestId
      );
      if (stale)
        await pool.query(
          "update report_intakes set metadata=jsonb_build_object('report_ban_operation_id','claimed') where id=$1",
          [report]
        );
      const client = mockDeep<Client>();
      client.guilds.fetch.mockResolvedValue({
        id: 'guild',
        ownerId: 'owner',
        roles: { fetch: async () => null },
        members: {
          fetch: async () => ({
            id: 'actor',
            permissions: { bitfield: 32n },
            roles: { cache: new Map() },
          }),
        },
      } as never);
      const configService = mockDeep<IConfigService>();
      configService.getServerConfig.mockResolvedValue({ settings: {} } as never);
      const worker = createBotDelegatedRuntime({
        prisma: getPrismaClient(),
        client,
        configService,
      });
      const execute = jest.fn(async () => ({
        kind: 'outcome',
        outcome: { kind: 'open_case_from_observed_detection', succeeded: true },
      }));
      const request = (
        await pool.query('select * from moderation_action_requests where id=$1', [
          accepted.queueRequestId,
        ])
      ).rows[0];
      const prepared = await prepareQueuedRequest({
        request,
        runtime: {
          delegation: worker,
          cases: { execute },
          caseConfirmations: { recordVerified: jest.fn() },
        } as never,
        analytics: {} as never,
      });
      const result = await prepared.execute();
      expect(result).toMatchObject(
        stale ? { state: 'denied', code: 'stale_state' } : { opened: true }
      );
      expect(execute).toHaveBeenCalledTimes(stale ? 0 : 1);
    }
  );
});
