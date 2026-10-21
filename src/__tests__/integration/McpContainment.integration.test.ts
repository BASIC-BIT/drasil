import {
  createBotMessageCleanupRuntime,
  type BotMessageCleanupDependencies,
} from '../../application/adapters/messageCleanup';
import {
  createBotQuarantineRuntime,
  type BotQuarantineDependencies,
} from '../../application/adapters/quarantine';
import { MessageDeletionJobRepository } from '../../repositories/MessageDeletionJobRepository';
import {
  MessageCleanupService,
  type MessageCleanupDeletionService,
} from '../../services/MessageCleanupService';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  createContainmentIntentResolver,
  createIntentService,
  createDelegatedAccess,
  createDelegatedActionService,
  decodeQueuedAction,
  encodeIntentDelivery,
  projectExecution,
  type DelegatedPrincipal,
  type IntentInvocation,
  type IntentRecord,
} from '@drasil/application';
import {
  createContainmentResources,
  createDelegationStore,
  type DelegationDatabase,
} from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import {
  createBotDelegationDatabase,
  createDelegatedWorkerAdmission,
} from '../../application/adapters/delegation';
import { getPrismaClient } from '../testDb';
import {
  createBotCaptchaRuntime,
  type BotCaptchaDependencies,
} from '../../application/adapters/captcha';
import { CaptchaChallengeService } from '../../services/CaptchaChallengeService';
import { CaptchaChallengeRepository } from '../../repositories/CaptchaChallengeRepository';
import { VerificationEventRepository } from '../../repositories/VerificationEventRepository';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { mockDeep } from 'jest-mock-extended';
import { prepareQueuedRequest } from '../../application/requestRuntime';
import type { QueuedRequestRuntime } from '../../application/requestDispatch';
import {
  CaptchaChallengePassEffect,
  CaptchaChallengeRequestSource,
} from '../../repositories/types';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration.each(['pg', 'prisma'] as const)('MCP containment via %s', (driver) => {
  let pool: Pool,
    database: DelegationDatabase,
    store: ReturnType<typeof createDelegationStore>,
    resources: ReturnType<typeof createContainmentResources>,
    principal: DelegatedPrincipal,
    access: ReturnType<typeof createDelegatedAccess>,
    caseId: string;
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
    resources = createContainmentResources(database);
    await pool.query(
      `insert into servers(guild_id,is_active,settings) values('guild',true,'{"captcha_mode":"manual","account_quarantine_enabled":true}')`
    );
    await pool.query(`insert into users(discord_id) values('target')`);
    caseId = (
      await pool.query(
        `insert into verification_events(server_id,user_id,private_evidence_thread_id) values('guild','target','evidence') returning id`
      )
    ).rows[0].id;
    const grant = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes: ['drasil:moderate'],
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
          owner: true,
          present: true,
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
  const options = () => ({
    caseId,
    targetUserId: 'target',
    mode: 'delete_only',
    scope: 'last_hour',
    reason: 'Remove spam',
    detectionEventId: null,
  });
  const invoke = (
    workflowId: IntentInvocation['workflowId'],
    input: unknown = options(),
    idempotencyKey = randomUUID()
  ): IntentInvocation => ({ workflowId, guildId: 'guild', input, idempotencyKey });
  const intents = (s = store) =>
    createIntentService({ store: s, access, resolver: createContainmentIntentResolver(resources) });
  async function prepareCleanup() {
    return intents().prepareIntent(principal, invoke('preview_case_message_deletion'));
  }
  async function completePreview(intent?: IntentRecord) {
    const saved = intent ?? (await prepareCleanup());
    const execution = await intents().acceptWithoutConfirmation(principal, saved.confirmationId);
    const jobId = saved.command.kind === 'preview_case_message_deletion' ? saved.command.jobId : '';
    const generation = new Date().toISOString();
    await pool.query(`update mcp_executions set started_at=now() where id=$1`, [
      execution.executionId,
    ]);
    await pool.query(
      `update message_deletion_jobs set status='ready',coverage='ready',candidate_count=2,previewed_at=$2 where id=$1`,
      [jobId, generation]
    );
    await pool.query(
      `update moderation_action_requests set status='completed',completed_at=now(),result=$2::jsonb where id=$1`,
      [
        execution.queueRequestId,
        JSON.stringify({
          action_type: 'preview_case_message_deletion',
          message_deletion_job_id: jobId,
          preview_generation: generation,
          target_user_id: 'target',
          verification_event_id: caseId,
          candidate_count: 2,
          status: 'ready',
        }),
      ]
    );
    return { execution, jobId, generation };
  }
  it('reserves without writes then atomically creates exactly one job, execution and queue on concurrent acceptance', async () => {
    const saved = await prepareCleanup();
    expect(
      (await pool.query('select count(*)::int as n from message_deletion_jobs')).rows[0].n
    ).toBe(0);
    const executions = await Promise.all([
      intents().acceptWithoutConfirmation(principal, saved.confirmationId),
      intents().acceptWithoutConfirmation(principal, saved.confirmationId),
    ]);
    expect(executions[0].executionId).toBe(executions[1].executionId);
    const rows = (await pool.query('select * from message_deletion_jobs')).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: saved.command.kind === 'preview_case_message_deletion' ? saved.command.jobId : '',
      requested_by: 'actor',
      actor_surface: 'mcp',
      evidence_thread_id: 'evidence',
    });
  });
  it('rolls back provision if queue insertion fails', async () => {
    const saved = await prepareCleanup();
    const failing = createDelegationStore({
      ...database,
      transaction: (operation) =>
        database.transaction((client) =>
          operation({
            query: async (text, values) => {
              if (text.includes('insert into moderation_action_requests'))
                throw new Error('forced queue failure');
              return client.query(text, values);
            },
          })
        ),
    });
    await expect(
      failing.acceptIntent(
        principal,
        saved.confirmationId,
        'not_required',
        encodeIntentDelivery(saved)
      )
    ).rejects.toThrow('forced queue failure');
    expect(
      (await pool.query('select count(*)::int as n from message_deletion_jobs')).rows[0].n
    ).toBe(0);
    expect((await store.loadIntent(principal, saved.confirmationId))?.state).toBe('pending');
  });
  it.each(['revision', 'evidence', 'target', 'status'] as const)(
    'validates locked case %s inside acceptance',
    async (field) => {
      const saved = await prepareCleanup();
      const updates = {
        revision: 'case_revision=case_revision+1',
        evidence: "private_evidence_thread_id='changed'",
        target: 'user_id=null',
        status: "status='verified'",
      };
      await pool.query(`update verification_events set ${updates[field]} where id=$1`, [caseId]);
      await expect(
        store.acceptIntent(
          principal,
          saved.confirmationId,
          'not_required',
          encodeIntentDelivery(saved)
        )
      ).rejects.toThrow('stale_state');
      expect(
        (await pool.query('select count(*)::int as n from message_deletion_jobs')).rows[0].n
      ).toBe(0);
    }
  );
  it('rejects a foreign saved UUID instead of adopting its job', async () => {
    const saved = await prepareCleanup();
    const p = saved.preconditions;
    if (p.kind !== 'cleanup_job_provision') throw new Error('provision expected');
    await pool.query(
      `insert into message_deletion_jobs(id,server_id,user_id,verification_event_id,requested_by,actor_surface,mode,scope,reason,evidence_thread_id) values($1,'guild','target',$2,'other','web','delete_only','last_hour','foreign','evidence')`,
      [p.jobId, caseId]
    );
    await expect(
      store.acceptIntent(
        principal,
        saved.confirmationId,
        'not_required',
        encodeIntentDelivery(saved)
      )
    ).rejects.toThrow('queue_conflict');
    expect(
      (await pool.query('select requested_by from message_deletion_jobs where id=$1', [p.jobId]))
        .rows[0].requested_by
    ).toBe('other');
  });
  it('serializes native and MCP active case work', async () => {
    const saved = await prepareCleanup();
    await pool.query(
      `insert into moderation_action_requests(server_id,actor_id,actor_surface,action_type,target_user_id,verification_event_id,idempotency_key) values('guild','actor','web','request_captcha_challenge','target',$1,'native')`,
      [caseId]
    );
    await expect(
      intents().acceptWithoutConfirmation(principal, saved.confirmationId)
    ).rejects.toThrow('queue_conflict');
    expect(
      (await pool.query('select count(*)::int as n from message_deletion_jobs')).rows[0].n
    ).toBe(0);
  });
  it('rejects reuse of another connections cleanup preview', async () => {
    const { execution } = await completePreview();
    const foreign = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes: ['drasil:moderate'],
    });
    const cleanupEffects = jest.fn();
    const service = createDelegatedActionService({
      store,
      access,
      resolver: createContainmentIntentResolver(resources),
      direct: { execute: cleanupEffects },
    });
    const result = await service.submit(
      { ...principal, connectionId: foreign.connectionId },
      invoke('execute_case_message_deletion', {
        ...options(),
        cleanupReference: execution.executionId,
      })
    );
    expect(result.state).toBe('denied');
    expect(cleanupEffects).not.toHaveBeenCalled();
    expect(
      (await pool.query('select count(*)::int as n from moderation_action_requests')).rows[0].n
    ).toBe(1);
  });
  it.each(['userId', 'clientId', 'connectionId', 'grantVersion'] as const)(
    'rejects foreign preview %s',
    async (field) => {
      const { execution } = await completePreview();
      await expect(
        resources.resolvePreviewReference(
          {
            ...principal,
            [field]:
              field === 'grantVersion' ? 2 : field === 'connectionId' ? randomUUID() : 'other',
          },
          execution.executionId
        )
      ).rejects.toThrow('preview_not_found');
    }
  );
  it('binds actual generation, rejects new generation and exposes only an opaque handle', async () => {
    const { execution, jobId } = await completePreview();
    expect(await resources.resolvePreviewReference(principal, execution.executionId)).toMatchObject(
      { kind: 'cleanup', expiresAt: null, job: { id: jobId } }
    );
    const publicResult = projectExecution(
      (await store.loadExecution(principal, execution.executionId))!
    );
    expect(publicResult.previewReference).toBe(execution.executionId);
    expect(publicResult.previewExpiresAt).toBeNull();
    expect(JSON.stringify(publicResult)).not.toMatch(
      /preview_generation|fingerprint|token|message_deletion_job_id/
    );
    const saved = await intents().prepareIntent(
      principal,
      invoke('execute_case_message_deletion', {
        ...options(),
        cleanupReference: execution.executionId,
      })
    );
    await pool.query(
      `update message_deletion_jobs set previewed_at=previewed_at+interval '1 second' where id=$1`,
      [jobId]
    );
    await expect(
      intents().acceptIntent(principal, saved.confirmationId, 'client_confirmation')
    ).rejects.toThrow();
  });
  it.each(['caseId', 'targetUserId', 'scope', 'reason'] as const)(
    'rejects changed cleanup %s',
    async (field) => {
      const { execution } = await completePreview();
      await expect(
        intents().prepareIntent(
          principal,
          invoke('execute_case_message_deletion', {
            ...options(),
            cleanupReference: execution.executionId,
            [field]: field === 'scope' ? 'last_day' : 'other',
          })
        )
      ).rejects.toThrow();
    }
  );
  it('allows only one active execution intent for a frozen job', async () => {
    const { execution } = await completePreview();
    const a = await intents().prepareIntent(
      principal,
      invoke('execute_case_message_deletion', {
        ...options(),
        cleanupReference: execution.executionId,
      })
    );
    const b = await intents().prepareIntent(
      principal,
      invoke('execute_case_message_deletion', {
        ...options(),
        cleanupReference: execution.executionId,
      })
    );
    const outcomes = await Promise.allSettled([
      intents().acceptIntent(principal, a.confirmationId, 'client_confirmation'),
      intents().acceptIntent(principal, b.confirmationId, 'client_confirmation'),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  });
  it('resolves persisted quarantine without consuming it and expires after ten minutes', async () => {
    const saved = await intents().prepareIntent(
      principal,
      invoke('preview_account_quarantine', { caseId, targetUserId: 'target' })
    );
    const execution = await intents().acceptWithoutConfirmation(principal, saved.confirmationId);
    await pool.query('update mcp_executions set started_at=now() where id=$1', [
      execution.executionId,
    ]);
    await pool.query(
      `update moderation_action_requests set status='completed',completed_at=now(),result=$2::jsonb where id=$1`,
      [
        execution.queueRequestId,
        JSON.stringify({
          action_type: 'preview_account_quarantine',
          verification_event_id: caseId,
          target_user_id: 'target',
          containment_fingerprint: 'private-fingerprint',
          planned_roles: [{ role_id: 'role' }],
          retained_roles: [],
          can_contain: true,
        }),
      ]
    );
    const preview = await resources.resolvePreviewReference(principal, execution.executionId);
    expect(await resources.resolvePreviewReference(principal, execution.executionId)).toEqual(
      preview
    );
    const confirmation = await intents().prepareIntent(
      principal,
      invoke('quarantine_compromised_account', {
        caseId,
        targetUserId: 'target',
        reason: 'Contain compromise',
        previewReference: execution.executionId,
      })
    );
    expect(confirmation.summary).toContain('role');
    expect(confirmation.summary).not.toContain('private-fingerprint');
    expect(
      projectExecution((await store.loadExecution(principal, execution.executionId))!)
        .previewExpiresAt
    ).toBeTruthy();
    await pool.query(
      `update moderation_action_requests set completed_at=now()-interval '11 minutes' where id=$1`,
      [execution.queueRequestId]
    );
    await expect(
      intents().acceptIntent(principal, confirmation.confirmationId, 'client_confirmation')
    ).rejects.toThrow();
  });
  it('admits only recorded committed CAPTCHA continuation after the started gate', async () => {
    const saved = await intents().prepareIntent(
      principal,
      invoke('request_captcha_challenge', { caseId, targetUserId: 'target' })
    );
    const execution = await intents().acceptIntent(
      principal,
      saved.confirmationId,
      'client_confirmation'
    );
    let request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    expect(
      (
        await store.admitQueuedExecution(
          { request, action: decodeQueuedAction(request), recovery: false },
          (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
        )
      ).kind
    ).toBe('new_execution');
    expect(
      (
        await store.admitQueuedExecution(
          { request, action: decodeQueuedAction(request), recovery: false },
          (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
        )
      ).kind
    ).toBe('already_bound');
    await pool.query(
      `update moderation_action_requests set metadata=metadata || '{"captcha_mutation_receipt":{"operation":"request","challenge_id":"challenge","generation":1}}'::jsonb where id=$1`,
      [execution.queueRequestId]
    );
    request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    expect(
      (
        await store.admitQueuedExecution(
          { request, action: decodeQueuedAction(request), recovery: false },
          async () => ({ kind: 'denied', reason: 'permission_denied' })
        )
      ).kind
    ).toBe('committed_containment');
  });
  function captchaRuntime() {
    const prisma = getPrismaClient();
    const repository = new CaptchaChallengeRepository(prisma);
    const events = new VerificationEventRepository(prisma);
    const deps = mockDeep<BotCaptchaDependencies>();
    deps.configService.getServerConfig.mockResolvedValue({
      settings: { captcha_mode: 'manual' },
    } as never);
    deps.confirmations.verify.mockResolvedValue(true);
    deps.client.guilds.fetch.mockResolvedValue({ members: { fetch: async () => ({}) } } as never);
    const service = new CaptchaChallengeService(
      repository,
      events,
      {} as never,
      deps.configService,
      deps.threadManager,
      deps.notificationManager,
      new ModerationActionRequestRepository(prisma)
    );
    const runtime = createBotCaptchaRuntime(
      { ...deps, verificationEventRepository: events, captchaChallengeService: service },
      {
        loadFresh: async () => ({
          guildId: 'guild',
          userId: 'actor',
          owner: true,
          present: true,
          permissions: '8',
          roleIds: [],
        }),
      }
    );
    return { repository, events, deps, service, runtime };
  }
  async function seedChallenge(repository: CaptchaChallengeRepository) {
    return repository.create({
      verificationEventId: caseId,
      serverId: 'guild',
      userId: 'target',
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      tokenHash: 'private-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'actor',
    });
  }
  it.each(['request', 'retry', 'bypass'] as const)(
    'carries approved revision through scoped %s runtime to transactional CAS',
    async (operation) => {
      const { runtime, repository, deps } = captchaRuntime();
      const challenge = operation === 'request' ? null : await seedChallenge(repository);
      if (challenge && operation === 'retry')
        await pool.query("update captcha_challenges set status='failed' where id=$1", [
          challenge.id,
        ]);
      const workflowId =
        operation === 'request'
          ? 'request_captcha_challenge'
          : operation === 'retry'
            ? 'retry_captcha_challenge'
            : 'bypass_captcha_challenge';
      const saved = await intents().prepareIntent(
        principal,
        invoke(workflowId, {
          caseId,
          targetUserId: 'target',
          ...(challenge
            ? { expectedChallengeId: challenge.id, expectedGeneration: challenge.generation }
            : {}),
          ...(operation === 'bypass' ? { reason: 'Reviewed' } : {}),
        })
      );
      const execution = await intents().acceptIntent(
        principal,
        saved.confirmationId,
        'client_confirmation'
      );
      await pool.query("update moderation_action_requests set status='processing' where id=$1", [
        execution.queueRequestId,
      ]);
      const request = (
        await pool.query('select * from moderation_action_requests where id=$1', [
          execution.queueRequestId,
        ])
      ).rows[0];
      // Advance state after the service has read it, immediately before the real locked write.
      if (operation === 'request') {
        const original = repository.create.bind(repository);
        jest.spyOn(repository, 'create').mockImplementation(async (input) => {
          expect(input.caseRevision).toBe(0);
          await pool.query('update verification_events set case_revision=1 where id=$1', [caseId]);
          return original(input);
        });
      }
      if (operation === 'retry') {
        const original = repository.retry.bind(repository);
        jest.spyOn(repository, 'retry').mockImplementation(async (input) => {
          expect(input.caseRevision).toBe(0);
          await pool.query('update verification_events set case_revision=1 where id=$1', [caseId]);
          return original(input);
        });
      }
      if (operation === 'bypass') {
        const original = repository.bypass.bind(repository);
        jest.spyOn(repository, 'bypass').mockImplementation(async (...args) => {
          expect(args[5]).toBe(0);
          await pool.query('update verification_events set case_revision=1 where id=$1', [caseId]);
          return original(...args);
        });
      }
      const prepared = await prepareQueuedRequest({
        request,
        runtime: {
          captchaRuntime: runtime,
          caseConfirmations: { recordVerified: jest.fn() },
          delegation: createDelegatedWorkerAdmission({ store, access }),
        } as unknown as QueuedRequestRuntime,
        analytics: {} as never,
      });
      expect(await prepared.execute()).toMatchObject({ state: 'denied', code: 'stale_state' });
      const current = await repository.findByCaseId(caseId);
      expect(current?.generation ?? 0).toBe(challenge?.generation ?? 0);
      if (operation === 'bypass') expect(current?.status).toBe('pending');
      expect(deps.threadManager.sendCaptchaChallenge).not.toHaveBeenCalled();
      const persisted = (
        await pool.query('select metadata from moderation_action_requests where id=$1', [
          execution.queueRequestId,
        ])
      ).rows[0];
      expect(persisted.metadata.captcha_mutation_receipt).toBeUndefined();
    }
  );
  it('denies queued CAPTCHA when the saved case revision changes before service reads', async () => {
    const { runtime, repository } = captchaRuntime();
    const saved = await intents().prepareIntent(
      principal,
      invoke('request_captcha_challenge', { caseId, targetUserId: 'target' })
    );
    const execution = await intents().acceptIntent(
      principal,
      saved.confirmationId,
      'client_confirmation'
    );
    await pool.query('update verification_events set case_revision=1 where id=$1', [caseId]);
    const request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    const prepared = await prepareQueuedRequest({
      request,
      runtime: {
        captchaRuntime: runtime,
        caseConfirmations: { recordVerified: jest.fn() },
        delegation: createDelegatedWorkerAdmission({ store, access }),
      } as unknown as QueuedRequestRuntime,
      analytics: {} as never,
    });
    expect(await prepared.execute()).toMatchObject({ state: 'denied', code: 'stale_state' });
    expect(await repository.findByCaseId(caseId)).toBeNull();
  });
  it('recovers a real committed CAPTCHA mutation after revocation without another issue or delivery', async () => {
    const { runtime, repository, deps } = captchaRuntime();
    const saved = await intents().prepareIntent(
      principal,
      invoke('request_captcha_challenge', { caseId, targetUserId: 'target' })
    );
    const execution = await intents().acceptIntent(
      principal,
      saved.confirmationId,
      'client_confirmation'
    );
    await pool.query("update moderation_action_requests set status='processing' where id=$1", [
      execution.queueRequestId,
    ]);
    let request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    await store.admitQueuedExecution(
      { request, action: decodeQueuedAction(request), recovery: false },
      (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
    );
    await repository.create({
      actionRequestId: execution.queueRequestId!,
      verificationEventId: caseId,
      serverId: 'guild',
      userId: 'target',
      requestSource: CaptchaChallengeRequestSource.MODERATOR,
      passEffect: CaptchaChallengePassEffect.EVIDENCE_ONLY,
      caseRevision: 0,
      tokenHash: 'private-token-hash',
      expiresAt: new Date(Date.now() + 60_000),
      requestedBy: 'actor',
    });
    await store.revokeConnection(principal, 1);
    request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    const create = jest.spyOn(repository, 'create');
    const prepared = await prepareQueuedRequest({
      request,
      runtime: {
        captchaRuntime: runtime,
        caseConfirmations: { recordVerified: jest.fn() },
        delegation: createDelegatedWorkerAdmission({ store, access }),
      } as unknown as QueuedRequestRuntime,
      analytics: {} as never,
    });
    const result = await prepared.execute();
    expect(result).toMatchObject({
      action_type: 'request_captcha_challenge',
      resumed: true,
      delivered: false,
    });
    expect(create).not.toHaveBeenCalled();
    expect(deps.client.guilds.fetch).not.toHaveBeenCalled();
    await prepared.onComplete!(result);
    expect(
      (await store.loadExecution(principal, execution.executionId))?.outcome?.result.state
    ).toBe('partial');
  });

  it.each(['delete_only', 'ban_with_cleanup'] as const)(
    'continues completed %s bookkeeping through scoped runtime with no new deletion or ban',
    async (mode) => {
      const previewIntent = await intents().prepareIntent(
        principal,
        invoke('preview_case_message_deletion', { ...options(), mode })
      );
      const { execution: preview, jobId } = await completePreview(previewIntent);
      const kind =
        mode === 'delete_only'
          ? 'execute_case_message_deletion'
          : 'ban_case_user_with_message_cleanup';
      const saved = await intents().prepareIntent(
        principal,
        invoke(kind, { ...options(), mode, cleanupReference: preview.executionId })
      );
      const execution = await intents().acceptIntent(
        principal,
        saved.confirmationId,
        'client_confirmation'
      );
      await pool.query("update moderation_action_requests set status='processing' where id=$1", [
        execution.queueRequestId,
      ]);
      const request = (
        await pool.query('select * from moderation_action_requests where id=$1', [
          execution.queueRequestId,
        ])
      ).rows[0];
      await store.admitQueuedExecution(
        { request, action: decodeQueuedAction(request), recovery: false },
        (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
      );
      await pool.query(
        `update message_deletion_jobs set status='completed',ban_status=$2::message_deletion_ban_status,case_finalization_status=$3::message_deletion_case_finalization_status,metadata=$4::jsonb where id=$1`,
        [
          jobId,
          mode === 'delete_only' ? 'not_requested' : 'succeeded',
          mode === 'delete_only' ? 'not_applicable' : 'failed',
          JSON.stringify({
            combined_operation: { requestId: request.id, actorId: 'actor', source: 'mcp' },
          }),
        ]
      );
      await store.revokeConnection(principal, 1);
      const prisma = getPrismaClient(),
        jobs = new MessageDeletionJobRepository(prisma),
        events = new VerificationEventRepository(prisma);
      const deps = mockDeep<BotMessageCleanupDependencies>();
      deps.client.guilds.fetch.mockResolvedValue({
        members: { fetchMe: async () => ({ permissions: { has: () => true } }) },
      } as never);
      deps.client.users.fetch.mockResolvedValue({ id: 'actor' } as never);
      const deletion = mockDeep<MessageCleanupDeletionService>();
      const cleanup = new MessageCleanupService(
        deps.client,
        jobs,
        events,
        {} as never,
        {} as never,
        {} as never,
        deletion
      );
      const runtime = createBotMessageCleanupRuntime({
        ...deps,
        messageDeletionJobs: jobs,
        userModerationService: deps.userModerationService,
        verificationEventRepository: events,
        messageCleanupService: cleanup,
      });
      const prepared = await prepareQueuedRequest({
        request,
        runtime: {
          messageCleanupRuntime: runtime,
          caseConfirmations: { recordVerified: jest.fn() },
          delegation: createDelegatedWorkerAdmission({ store, access }),
        } as unknown as QueuedRequestRuntime,
        analytics: {} as never,
      });
      const result = await prepared.execute();
      expect(result).toMatchObject({ action_type: kind, already_completed: true });
      expect(deletion.deleteMessage).not.toHaveBeenCalled();
      expect(deletion.bulkDeleteMessages).not.toHaveBeenCalled();
      expect(deps.userModerationService.performDiscordBanById).not.toHaveBeenCalled();
      if (mode === 'ban_with_cleanup')
        expect(deps.userModerationService.finalizeSuccessfulCombinedBan).toHaveBeenCalledTimes(1);
      await new ModerationActionRequestRepository(prisma).complete(request.id, result);
      await prepared.onComplete!(result);
      await prepared.afterComplete!();
      expect(
        (await store.loadExecution(principal, execution.executionId))?.outcome?.result.state
      ).toBe('completed');
    }
  );
  it('refuses foreign completed cleanup ownership rather than resuming enforcement', async () => {
    const previewIntent = await intents().prepareIntent(
      principal,
      invoke('preview_case_message_deletion', { ...options(), mode: 'ban_with_cleanup' })
    );
    const { execution: preview, jobId } = await completePreview(previewIntent);
    const saved = await intents().prepareIntent(
      principal,
      invoke('ban_case_user_with_message_cleanup', {
        ...options(),
        mode: 'ban_with_cleanup',
        cleanupReference: preview.executionId,
      })
    );
    const execution = await intents().acceptIntent(
      principal,
      saved.confirmationId,
      'client_confirmation'
    );
    const request = (
      await pool.query('select * from moderation_action_requests where id=$1', [
        execution.queueRequestId,
      ])
    ).rows[0];
    await store.admitQueuedExecution(
      { request, action: decodeQueuedAction(request), recovery: false },
      (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
    );
    await pool.query(
      `update message_deletion_jobs set status='completed',ban_status='succeeded',metadata='{"combined_operation":{"requestId":"foreign","actorId":"actor","source":"mcp"}}' where id=$1`,
      [jobId]
    );
    expect(
      (
        await store.admitQueuedExecution(
          { request, action: decodeQueuedAction(request), recovery: false },
          (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
        )
      ).kind
    ).toBe('already_bound');
  });
  it.each(['contained', 'incomplete'] as const)(
    'continues committed quarantine %s receipt without repeating containment',
    async (result) => {
      const savedPreview = await intents().prepareIntent(
        principal,
        invoke('preview_account_quarantine', { caseId, targetUserId: 'target' })
      );
      const preview = await intents().acceptWithoutConfirmation(
        principal,
        savedPreview.confirmationId
      );
      await pool.query('update mcp_executions set started_at=now() where id=$1', [
        preview.executionId,
      ]);
      await pool.query(
        `update moderation_action_requests set status='completed',completed_at=now(),result=$2 where id=$1`,
        [
          preview.queueRequestId,
          JSON.stringify({
            action_type: 'preview_account_quarantine',
            verification_event_id: caseId,
            target_user_id: 'target',
            containment_fingerprint: 'private',
            planned_roles: [],
            retained_roles: [],
            can_contain: true,
          }),
        ]
      );
      const saved = await intents().prepareIntent(
        principal,
        invoke('quarantine_compromised_account', {
          caseId,
          targetUserId: 'target',
          reason: 'Contain compromise',
          previewReference: preview.executionId,
        })
      );
      const execution = await intents().acceptIntent(
        principal,
        saved.confirmationId,
        'client_confirmation'
      );
      const request = (
        await pool.query('select * from moderation_action_requests where id=$1', [
          execution.queueRequestId,
        ])
      ).rows[0];
      await store.admitQueuedExecution(
        { request, action: decodeQueuedAction(request), recovery: false },
        (p, e) => access.authorizeWorkflow(p, e.guildId, e.command)
      );
      await pool.query(
        `update verification_events set case_kind='compromised_account',containment_status=$2::case_containment_status,attention_state=$3::case_attention_state,metadata=$4 where id=$1`,
        [
          caseId,
          result,
          result === 'contained' ? 'parked' : 'review_required',
          JSON.stringify({
            account_quarantine: {
              moderation_action_request_id: request.id,
              result,
              failed_removals: result === 'incomplete' ? ['role'] : [],
              member_bypasses: [],
              retained_roles: [],
            },
          }),
        ]
      );
      await store.revokeConnection(principal, 1);
      const deps = mockDeep<BotQuarantineDependencies>();
      const runtime = createBotQuarantineRuntime({
        ...deps,
        verificationEventRepository: new VerificationEventRepository(getPrismaClient()),
        accountQuarantineService: deps.accountQuarantineService,
      });
      const prepared = await prepareQueuedRequest({
        request,
        runtime: {
          quarantineRuntime: runtime,
          caseConfirmations: { recordVerified: jest.fn() },
          delegation: createDelegatedWorkerAdmission({ store, access }),
        } as unknown as QueuedRequestRuntime,
        analytics: {} as never,
      });
      const outcome = await prepared.execute();
      expect(outcome).toMatchObject({
        action_type: 'quarantine_compromised_account',
        containment_status: result,
        recovered_after_worker_interruption: true,
      });
      expect(deps.accountQuarantineService!.quarantine).not.toHaveBeenCalled();
      expect(deps.client.guilds.fetch).not.toHaveBeenCalled();
      await prepared.onComplete!(outcome);
      expect(
        (await store.loadExecution(principal, execution.executionId))?.outcome?.result.state
      ).toBe(result === 'contained' ? 'completed' : 'partial');
    }
  );
});
