import { Pool } from 'pg';
import {
  createDelegatedActionService,
  createDelegatedAccess,
  createDetectionActions,
  createIntentService,
  encodeIntentDelivery,
  canonicalDigest,
  decodeQueuedAction,
  setupServerRecordSchema,
  type DelegatedPrincipal,
  type IntentResolver,
} from '@drasil/application';
import { createDelegationStore, buildEnqueueStatement } from '@drasil/application/postgres';
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
integration.each(['pg', 'prisma'] as const)('MCP durable delivery via %s', (driver) => {
  let pool: Pool;
  let store: ReturnType<typeof createDelegationStore>;
  let principal: DelegatedPrincipal;
  let access: ReturnType<typeof createDelegatedAccess>;
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
    access = createDelegatedAccess({
      store,
      authority: {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: true,
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
  it('denies revoked queued work before effects', async () => {
    const receipt = await accept();
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    await store.revokeConnection(principal, 1);
    const workflow = { execute: jest.fn() };
    const caseConfirmations = { recordVerified: jest.fn() };
    const delegation = createDelegatedWorkerAdmission({ store, access });
    const prepared = await prepareQueuedRequest({
      request,
      runtime: { delegation, operations: workflow, caseConfirmations } as never,
      analytics: {} as never,
    });
    const result = await prepared.execute();
    if (!('state' in result)) throw new Error('Expected delegated admission result');
    expect(result.state).toBe('denied');
    expect(workflow.execute).not.toHaveBeenCalled();
    expect(caseConfirmations.recordVerified).not.toHaveBeenCalled();
    expect(receipt.state).toBe('queued');
  });
  it('accepts once and admits without an OAuth access token', async () => {
    const receipt = await accept();
    const repeated = await service().submit(principal, invocation);
    expect(repeated.executionId).toBe(receipt.executionId);
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    const worker = createDelegatedWorkerAdmission({ store, access });
    expect(
      (await worker.authorizeDelegatedRequest(request, false, decodeQueuedAction(request))).kind
    ).toBe('new_execution');
    expect(
      (await worker.authorizeDelegatedRequest(request, false, decodeQueuedAction(request))).kind
    ).toBe('already_bound');
    expect(Number((await pool.query('select count(*) from mcp_executions')).rows[0].count)).toBe(1);
  });
  it('rejects forged bindings and actor or payload mismatches', async () => {
    await accept();
    const original = (await pool.query('select * from moderation_action_requests')).rows[0];
    const worker = createDelegatedWorkerAdmission({ store, access });
    for (const request of [
      { ...original, actor_id: 'other' },
      {
        ...original,
        metadata: {
          ...original.metadata,
          delegation: { ...original.metadata.delegation, commandDigest: 'forged' },
        },
      },
    ]) {
      expect(
        (await worker.authorizeDelegatedRequest(request, false, decodeQueuedAction(request))).kind
      ).toBe('denied');
    }
  });

  it('persists direct completion without inserting a queue row and never repeats an interrupted effect', async () => {
    const directResolver: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'direct' },
        preconditions: { kind: 'none' },
        relevantState: {},
        summary: 'Acknowledge attention',
        previewExpiresAt: null,
      }),
    };
    const execute = jest.fn(async () => ({
      kind: 'attention_batch' as const,
      items: [{ itemId: 'one', state: 'completed' as const, status: 'acknowledged' }],
    }));
    const direct = createDelegatedActionService({
      store,
      access,
      resolver: directResolver,
      direct: { execute },
    });
    const input = {
      workflowId: 'acknowledge_attention' as const,
      guildId: 'guild',
      idempotencyKey: 'direct',
      input: { itemIds: ['one'] },
    };
    const result = await direct.submit(principal, input);
    expect(result.state).toBe('completed');
    expect((await direct.submit(principal, input)).executionId).toBe(result.executionId);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      Number((await pool.query('select count(*) from moderation_action_requests')).rows[0].count)
    ).toBe(0);
    const intents = createIntentService({ store, access, resolver: directResolver });
    const pending = await intents.prepareIntent(principal, {
      ...input,
      idempotencyKey: 'interrupted',
    });
    const accepted = await intents.acceptWithoutConfirmation(principal, pending.confirmationId);
    await store.startDirectExecution(accepted.executionId, () =>
      access.authorizeWorkflow(principal, 'guild', accepted.command)
    );
    expect(
      (await direct.submit(principal, { ...input, idempotencyKey: 'interrupted' })).state
    ).toBe('uncertain');
    expect((await direct.status(principal, accepted.executionId)).state).toBe('uncertain');
    expect(execute).toHaveBeenCalledTimes(1);
  });
  it('returns a durable receipt at the injected deadline and permits authorized polling', async () => {
    let finish!: () => void;
    const effect = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const execute = jest.fn(async () => {
      await effect;
      return { kind: 'attention_batch' as const, items: [] };
    });
    const direct = createDelegatedActionService({
      store,
      access,
      resolver: {
        resolve: async () => ({
          delivery: { kind: 'direct' },
          preconditions: { kind: 'none' },
          relevantState: {},
          summary: 'Acknowledge',
          previewExpiresAt: null,
        }),
      },
      direct: { execute },
      waitForExecution: async (_work, pending) => pending(),
    });
    const result = await direct.submit(principal, {
      workflowId: 'acknowledge_attention',
      guildId: 'guild',
      idempotencyKey: 'deadline',
      input: { itemIds: ['one'] },
    });
    expect(result).toMatchObject({ state: 'uncertain', retryAfterMs: 2000 });
    expect(
      (await direct.status({ ...principal, userId: 'foreign' }, result.executionId!)).state
    ).toBe('denied');
    finish();
    for (let i = 0; i < 50; i++) {
      if ((await direct.status(principal, result.executionId!)).state === 'completed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await direct.status(principal, result.executionId!)).state).toBe('completed');
  });
  it('does not expose foreign domain receipts and consumes a conflicting approval', async () => {
    await pool.query("insert into users (discord_id,username) values ('target','Target')");
    const detection = (
      await pool.query(
        "insert into detection_events (server_id,user_id,detection_type,confidence,reasons) values ('guild','target','user_report',1,'{}') returning id"
      )
    ).rows[0].id;
    const command = {
      kind: 'dismiss_observed_detection' as const,
      targetUserId: 'target',
      detectionEventId: detection,
    };
    const resolution: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'queued', command },
        preconditions: { kind: 'none' },
        relevantState: {},
        summary: 'Dismiss observation',
        previewExpiresAt: null,
      }),
    };
    const action = createDelegatedActionService({
      store,
      access,
      resolver: resolution,
      direct: { execute: jest.fn() },
    });
    const input = {
      workflowId: 'dismiss_observed_detection' as const,
      guildId: 'guild',
      idempotencyKey: 'foreign',
      input: { detectionEventId: detection, targetUserId: 'target' },
    };
    const prepared = await action.submit(principal, input);
    const intent = await store.loadIntent(principal, prepared.confirmationId!);
    const delivery = encodeIntentDelivery(intent!);
    if ('kind' in delivery) throw new Error('Expected queue');
    const statement = buildEnqueueStatement({
      ...delivery,
      actorId: 'foreign',
      actorSurface: 'web',
    });
    const foreign = (await pool.query(statement.text, [...statement.values])).rows[0];
    const result = await action.confirm(principal, prepared.confirmationId!, 'client_confirmation');
    expect(result).toEqual({ state: 'denied', code: 'queue_conflict' });
    expect((await store.loadIntent(principal, prepared.confirmationId!))?.state).toBe('denied');
    expect(
      (await pool.query('select * from moderation_action_requests where id=$1', [foreign.id]))
        .rows[0]
    ).toEqual(foreign);
  });
  it.each([
    ['ban_case_user', '4'],
    ['kick_case_user', '2'],
  ] as const)(
    'allows own minimal %s receipt without staff record read',
    async (kind, permissions) => {
      const authority = {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          present: true,
          owner: false,
          permissions,
          roleIds: [],
        }),
      };
      access = createDelegatedAccess({
        store,
        authority,
        staffRoles: { loadRoleIds: async () => [] },
        guilds: {
          isActive: async () => true,
          listActive: async () => ({ guildIds: [], nextCursor: null }),
        },
      });
      const command = { kind, caseId: 'case', targetUserId: 'target', reason: 'reason' };
      const resolved = {
        workflowId: kind,
        guildId: 'guild',
        command,
        commandDigest: canonicalDigest(command),
        authorizedDelivery: { kind: 'direct' },
        preconditions: { kind: 'none' },
        stateFingerprint: 'state',
        summary: 'Own action',
        previewExpiresAt: null,
      };
      // Imported historical receipt fixture exercises status policy independently of future codecs.
      await pool.query(
        "insert into mcp_intents (confirmation_id,connection_id,user_id,client_id,grant_version,idempotency_key,invocation_digest,input,resolved,expires_at,state) values ('saved',$1,'actor','client',1,'saved','digest','{}',$2,now()+interval '1 minute','consumed')",
        [principal.connectionId, JSON.stringify(resolved)]
      );
      const id = (
        await pool.query(
          "insert into mcp_executions (id,confirmation_id,connection_id,user_id,client_id,grant_version,resolved,confirmation_method,started_at) values (gen_random_uuid(),'saved',$1,'actor','client',1,$2,'client_confirmation',now()) returning id",
          [principal.connectionId, JSON.stringify(resolved)]
        )
      ).rows[0].id;
      expect(
        (await access.authorizeRead(principal, { kind: 'cases', guildId: 'guild' })).kind
      ).toBe('denied');
      const result = await service().status(principal, id);
      expect(result).toMatchObject({ state: 'uncertain', executionId: id, targetUserId: 'target' });
      expect(JSON.stringify(result)).not.toContain('caseId');
      expect(
        (
          await service().status(
            { ...principal, connectionId: '00000000-0000-0000-0000-000000000001' },
            id
          )
        ).state
      ).toBe('denied');
    }
  );
  it('reconciles a committed report ban after revocation without new enforcement', async () => {
    await pool.query("insert into users (discord_id,username) values ('target','Target')");
    const detection = (
      await pool.query(
        "insert into detection_events (server_id,user_id,detection_type,confidence,reasons) values ('guild','target','user_report',1,'{}') returning id"
      )
    ).rows[0].id;
    const command = {
      kind: 'ban_observed_detection' as const,
      targetUserId: 'target',
      detectionEventId: detection,
      reason: 'reason',
      subject: { kind: 'observed' as const },
    };
    const resolution: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'queued', command },
        preconditions: { kind: 'none' },
        relevantState: {},
        summary: 'Ban observed user',
        previewExpiresAt: null,
      }),
    };
    const action = createDelegatedActionService({
      store,
      access,
      resolver: resolution,
      direct: { execute: jest.fn() },
    });
    const pending = await action.submit(principal, {
      workflowId: 'ban_observed_detection_observed',
      guildId: 'guild',
      idempotencyKey: 'ban',
      input: { detectionEventId: detection, targetUserId: 'target', reason: 'reason' },
    });
    const receipt = await action.confirm(principal, pending.confirmationId!, 'client_confirmation');
    const worker = createDelegatedWorkerAdmission({ store, access });
    let request = (
      await pool.query('select * from moderation_action_requests where id=$1', [receipt.requestId])
    ).rows[0];
    expect(
      (await worker.authorizeDelegatedRequest(request, false, decodeQueuedAction(request))).kind
    ).toBe('new_execution');
    await pool.query(
      `update moderation_action_requests set metadata=metadata || '{"report_ban_phase":"discord_confirmed","report_ban_attempt_token":"attempt"}'::jsonb where id=$1`,
      [request.id]
    );
    request = (
      await pool.query('select * from moderation_action_requests where id=$1', [receipt.requestId])
    ).rows[0];
    await store.revokeConnection(principal, 1);
    const ban = jest.fn();
    const reconcile = jest.fn(async () => ({ status: 'banned' as const }));
    const actions = createDetectionActions({
      confirmations: { verify: async () => false },
      repository: {
        findDetection: async () => ({ guildId: 'guild', targetUserId: 'target', reportId: null }),
        findOperation: async () => ({
          id: request.id,
          guildId: 'guild',
          targetUserId: 'target',
          detectionEventId: detection,
          reportId: null,
          actorId: 'actor',
          source: 'mcp',
          owned: true,
          continuation: 'confirmed',
        }),
      },
      workflows: { ban, reconcile },
    } as never);
    const prepared = await prepareQueuedRequest({
      runtime: { delegation: worker, detectionRuntime: { forRequest: () => actions } } as never,
      request,
      analytics: {} as never,
      recovery: true,
    });
    const result = await prepared.execute();
    expect(result).toMatchObject({ observed_ban_result: { status: 'banned' } });
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(ban).not.toHaveBeenCalled();
  });

  it('rejects an otherwise valid decoded context from a different queue request', async () => {
    await accept();
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    const decoded = decodeQueuedAction(request);
    const result = await createDelegatedWorkerAdmission({
      store,
      access,
    }).authorizeDelegatedRequest(request, false, {
      ...decoded,
      context: { ...decoded.context, requestId: 'different' },
    });
    expect(result.kind).toBe('denied');
  });
  it('rechecks the persisted source even when a claimed snapshot looks valid', async () => {
    await accept();
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    await pool.query("update moderation_action_requests set actor_surface='web' where id=$1", [
      request.id,
    ]);
    expect(
      (
        await createDelegatedWorkerAdmission({ store, access }).authorizeDelegatedRequest(
          request,
          false,
          decodeQueuedAction(request)
        )
      ).kind
    ).toBe('denied');
  });
  it('does not admit execution when selection changes before start', async () => {
    await accept();
    const request = (await pool.query('select * from moderation_action_requests')).rows[0];
    await store.updateSelection(principal, { mode: 'selected', guildIds: [] }, 1);
    expect(
      (
        await createDelegatedWorkerAdmission({ store, access }).authorizeDelegatedRequest(
          request,
          false,
          decodeQueuedAction(request)
        )
      ).kind
    ).toBe('denied');
  });
  it('persists the completed worker receipt after the durable queue outcome', async () => {
    const receipt = await accept();
    const operations = {
      execute: jest.fn(async () => ({
        kind: 'outcome',
        outcome: { kind: 'clear_moderation_queue', removedCount: 3 },
      })),
    };
    const runtime = {
      operations,
      caseConfirmations: { recordVerified: jest.fn() },
      delegation: createDelegatedWorkerAdmission({ store, access }),
    };
    const worker = new ModerationActionRequestService(
      new ModerationActionRequestRepository(getPrismaClient()),
      runtime as never,
      {} as never
    );
    await worker.processPendingRequests(1);
    const result = await service().status(principal, receipt.executionId!);
    expect(result).toMatchObject({
      state: 'completed',
      outcome: { details: { removed_count: 3 } },
    });
    expect(operations.execute).toHaveBeenCalledTimes(1);
    await pool.query('update mcp_executions set outcome=$1::jsonb', [
      JSON.stringify({ kind: 'delegated_terminal', result: { state: 'partial' } }),
    ]);
    expect((await service().status(principal, receipt.executionId!)).state).toBe('completed');
    const saved = await store.findIntentByKey(principal, invocation.idempotencyKey);
    expect(
      (await service().confirm(principal, saved!.confirmationId, 'client_confirmation')).state
    ).toBe('completed');
    const execution = (await pool.query('select * from mcp_executions')).rows[0];
    expect(execution.started_at).toBeInstanceOf(Date);
    expect(execution.completed_at).toBeInstanceOf(Date);
  });

  it('retains report review and approved setup direct receipts without queue insertion', async () => {
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
    await pool.query(
      "update mcp_connections set scopes=array['drasil:read','drasil:moderate','drasil:configure'] where id=$1",
      [principal.connectionId]
    );
    principal = { ...principal, scopes: ['drasil:read', 'drasil:moderate', 'drasil:configure'] };
    const execute = jest.fn(async (_context, command, preconditions) =>
      command.kind === 'update_setup' && preconditions.kind === 'setup'
        ? { kind: 'update_setup' as const, server: approvedState }
        : {
            actor: { id: 'actor', surface: 'mcp' },
            action: 'dismiss_no_action' as const,
            reportId: 'report',
            reportStatus: 'dismissed' as const,
            status: 'closed' as const,
            queueCleanupStatus: 'failed' as const,
          }
    );
    const direct = createDelegatedActionService({
      store,
      access,
      direct: { execute },
      resolver: {
        resolve: async (_principal, input) => ({
          delivery: { kind: 'direct' },
          preconditions:
            input.workflowId === 'update_setup'
              ? { kind: 'setup', approvedState }
              : { kind: 'none' },
          relevantState: {},
          summary: 'Review exact change',
          previewExpiresAt: null,
        }),
      },
    });
    const report = await direct.submit(principal, {
      workflowId: 'close_submitted_report',
      guildId: 'guild',
      idempotencyKey: 'review',
      input: { reportId: 'report', action: 'dismiss_no_action' },
    });
    expect(report.state).toBe('partial');
    const setup = await direct.submit(principal, {
      workflowId: 'update_setup',
      guildId: 'guild',
      idempotencyKey: 'setup',
      input: { changes: { adminChannelId: '123' } },
    });
    expect(
      (await direct.confirm(principal, setup.confirmationId!, 'client_confirmation')).state
    ).toBe('completed');
    expect(execute.mock.calls[1][2]).toMatchObject({ kind: 'setup', approvedState });
    expect(
      Number((await pool.query('select count(*) from moderation_action_requests')).rows[0].count)
    ).toBe(0);
  });

  it('returns a safe denial for malformed receipt identifiers', async () => {
    expect(await service().status(principal, '-'.repeat(36))).toEqual({
      state: 'denied',
      code: 'not_found',
    });
  });

  it('rechecks current workflow authority when replaying a consumed confirmation', async () => {
    await accept();
    const saved = await store.findIntentByKey(principal, invocation.idempotencyKey);
    const deniedAccess = {
      ...access,
      authorizeWorkflow: jest.fn(async () => ({
        kind: 'denied' as const,
        reason: 'permission_denied' as const,
      })),
    };
    const denied = createDelegatedActionService({
      store,
      access: deniedAccess,
      resolver,
      direct: { execute: jest.fn() },
    });
    expect(await denied.confirm(principal, saved!.confirmationId, 'client_confirmation')).toEqual({
      state: 'denied',
      code: 'permission_denied',
    });
    expect(await denied.submit(principal, invocation)).toEqual({
      state: 'denied',
      code: 'permission_denied',
    });
  });

  it('uses action scope for mutation receipts and read scope for polling', async () => {
    const receipt = await accept();
    const saved = await store.findIntentByKey(principal, invocation.idempotencyKey);
    const mutationOnly = { ...principal, scopes: ['drasil:moderate' as const] };
    expect(
      (await service().confirm(mutationOnly, saved!.confirmationId, 'client_confirmation')).state
    ).toBe('queued');
    expect((await service().submit(mutationOnly, invocation)).state).toBe('queued');
    expect(await service().status(mutationOnly, receipt.executionId!)).toEqual({
      state: 'denied',
      code: 'scope_denied',
    });
  });
});
