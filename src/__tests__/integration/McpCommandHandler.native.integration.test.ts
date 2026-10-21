import { Pool } from 'pg';
import { Collection, type Client } from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import {
  createAttentionActions,
  createIntentService,
  createCaseIntentResolver,
  createReportIntentResolver,
  createContainmentIntentResolver,
  createSetupIntentResolver,
  parseSetupStoredRecord,
  shippedResetChanges,
  prepareSubmittedReportCaseOpen,
  createIntakeChoiceReferences,
  type DelegatedPrincipal,
  type IntentResolver,
  type IntentInvocation,
} from '@drasil/application';
import {
  createDelegationStore,
  createCaseResolutionResources,
  createReportResources,
  createContainmentResources,
} from '@drasil/application/postgres';
import { createBotMcpApprovals } from '../../application/adapters/approvals';
import {
  createBotDelegationDatabase,
  createBotDelegatedAccess,
} from '../../application/adapters/delegation';
import { createBotAttentionMessageDeleter } from '../../application/adapters/attention';
import { createBotAuthority } from '../../application/adapters/authority';
import { type BotSetupDependencies } from '../../application/adapters/setup';
import { ConfigService } from '../../config/ConfigService';
import { ServerRepository } from '../../repositories/ServerRepository';
import { ModerationQueueRepository } from '../../repositories/ModerationQueueRepository';
import { type IModerationQueueService } from '../../services/ModerationQueueService';
import { getPrismaClient } from '../testDb';
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration('McpCommandHandler native composition', () => {
  const guildId = '111111111111111111',
    actorId = '222222222222222222',
    targetUserId = '333333333333333333';
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  let principal: DelegatedPrincipal;
  let actorAllowed = true;
  let initial: ReturnType<typeof prepareWith>;
  function prepareWith(deps: Pick<Parameters<typeof createIntentService>[0], 'store' | 'access'>) {
    return (
      resolver: IntentResolver,
      invocation: Omit<IntentInvocation, 'guildId' | 'idempotencyKey'>
    ) =>
      createIntentService({ ...deps, resolver }).prepareIntent(principal, {
        ...invocation,
        guildId,
        idempotencyKey: invocation.workflowId,
      });
  }
  let approvals: ReturnType<typeof createBotMcpApprovals>;
  let cases: IntentResolver,
    reports: IntentResolver,
    setup: IntentResolver,
    containment: IntentResolver;
  let issueChoice: ReturnType<typeof choiceIssuer>;
  function choiceIssuer(choices: ReturnType<typeof createIntakeChoiceReferences>) {
    return async (intakeId: string) =>
      (await choices.issue(principal, guildId, intakeId)).reference;
  }
  const queue = mockDeep<IModerationQueueService>();
  beforeEach(async () => {
    actorAllowed = true;
    await pool.query('insert into servers(guild_id,is_active) values($1,true)', [guildId]);
    await pool.query('insert into users(discord_id) values($1),($2)', [actorId, targetUserId]);
    const client = mockDeep<Client>();
    client.guilds.fetch.mockResolvedValue({
      id: guildId,
      ownerId: targetUserId,
      roles: { fetch: async () => new Collection() },
      channels: { fetch: async () => new Collection() },
      members: {
        fetch: async () => ({
          id: actorId,
          permissions: { bitfield: actorAllowed ? 8n : 0n },
          roles: { cache: new Collection() },
        }),
      },
    } as never);
    const prisma = getPrismaClient();
    const configService = new ConfigService(new ServerRepository(prisma), client);
    const deps = {
      ...mockDeep<BotSetupDependencies>(),
      client,
      configService,
      prisma,
      queueService: queue,
    };
    const database = createBotDelegationDatabase(prisma);
    const store = createDelegationStore(database);
    const grant = await store.createConnection({
      userId: actorId,
      clientId: 'original',
      selection: { mode: 'selected', guildIds: [guildId] },
      scopes: ['drasil:moderate', 'drasil:configure'],
    });
    principal = { ...grant, grantVersion: grant.version };
    const access = createBotDelegatedAccess(deps, store);
    const authority = createBotAuthority(client);
    const attention = createAttentionActions({
      authority,
      repository: new ModerationQueueRepository(prisma),
      messageDeleter: createBotAttentionMessageDeleter(queue),
    });
    approvals = createBotMcpApprovals({ ...deps, attention });
    initial = prepareWith({ store, access });
    cases = createCaseIntentResolver({
      access,
      resources: () => createCaseResolutionResources(database, guildId, async () => null),
    });
    const resources = createReportResources(database);
    const staffRoles = { loadRoleIds: async () => [] };
    const choices = createIntakeChoiceReferences({
      ...resources,
      authority,
      staffRoles,
      secret: 'initial-web-only-fixture-secret',
    });
    issueChoice = choiceIssuer(choices);
    reports = createReportIntentResolver({
      access,
      resources: () => ({
        prepareSubmittedReportCaseOpen: (reportId) =>
          prepareSubmittedReportCaseOpen(
            {
              guildId,
              requestId: 'prepare',
              source: 'mcp',
              actor: { kind: 'user', userId: actorId },
            },
            { reportId },
            { authority, openCaseRepository: resources.openCaseRepository }
          ),
        resolveIntakeChoice: (reference) => choices.resolveIntakeChoice(principal, reference),
        loadReview: async () => null,
        message: async () => null,
        detection: async () => null,
      }),
    });
    setup = createSetupIntentResolver({
      authority,
      provider: { isConfigured: () => false },
      loadGuildResources: async () => ({ roles: [], channels: [] }),
      loadHeuristicDefaults: async (scope) => shippedResetChanges(scope),
      loadServer: async () =>
        parseSetupStoredRecord(
          (await pool.query('select * from servers where guild_id=$1', [guildId])).rows[0]
        ),
    });
    containment = createContainmentIntentResolver(createContainmentResources(database));
  });
  afterAll(() => pool.end());
  it('queues case approval without read scope and preserves original command/client', async () => {
    const intent = await initial(cases, {
      workflowId: 'ban_user',
      input: { targetUserId, reason: '@everyone <script> reason' },
    });
    const result = await approvals.approve(actorId, intent.confirmationId, 'discord', guildId);
    expect(result.state).toBe('queued');
    const rows = await pool.query('select actor_id, actor_surface from moderation_action_requests');
    expect(rows.rows).toEqual([{ actor_id: actorId, actor_surface: 'mcp' }]);
    expect((await approvals.approve(actorId, intent.confirmationId, 'website')).executionId).toBe(
      result.executionId
    );
  });
  it('rechecks case policy before queueing', async () => {
    const intent = await initial(cases, {
      workflowId: 'ban_user',
      input: { targetUserId, reason: 'reason' },
    });
    await pool.query(
      `update servers set settings='{"moderator_ban_action_enabled":false}' where guild_id=$1`,
      [guildId]
    );
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('denied');
    await pool.query(`update servers set settings='{}' where guild_id=$1`, [guildId]);
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('denied');
    expect((await pool.query('select * from moderation_action_requests')).rows).toHaveLength(0);
  });
  it('keeps an explicit permission denial terminal after authority is restored', async () => {
    const intent = await initial(cases, {
      workflowId: 'ban_user',
      input: { targetUserId, reason: 'reason' },
    });
    actorAllowed = false;
    await expect(approvals.load(actorId, intent.confirmationId, guildId)).rejects.toThrow();
    expect(
      (
        await pool.query('select state from mcp_intents where confirmation_id=$1', [
          intent.confirmationId,
        ])
      ).rows[0].state
    ).toBe('pending');
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('denied');
    actorAllowed = true;
    expect((await approvals.approve(actorId, intent.confirmationId, 'website')).state).toBe(
      'denied'
    );
    expect((await pool.query('select * from moderation_action_requests')).rows).toHaveLength(0);
  });
  it('executes setup through full approved-state CAS and rejects changed state', async () => {
    const intent = await initial(setup, {
      workflowId: 'update_setup',
      input: { changes: { userReportReasonRequired: false } },
    });
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('completed');
    expect(
      (await pool.query('select settings from servers where guild_id=$1', [guildId])).rows[0]
        .settings.user_report_reason_required
    ).toBe(false);
    // Approval replay never writes a second time even after another writer changes the setting.
    await pool.query(
      `update servers set settings=settings || '{"user_report_reason_required":true}' where guild_id=$1`,
      [guildId]
    );
    await approvals.approve(actorId, intent.confirmationId, 'website');
    expect(
      (await pool.query('select settings from servers where guild_id=$1', [guildId])).rows[0]
        .settings.user_report_reason_required
    ).toBe(true);
  });
  it('denies a changed full setup state before applying the approved edit', async () => {
    const intent = await initial(setup, {
      workflowId: 'update_setup',
      input: { changes: { userReportReasonRequired: false } },
    });
    await pool.query('update servers set admin_channel_id=$1 where guild_id=$2', [
      '444444444444444444',
      guildId,
    ]);
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('denied');
    expect(
      (await pool.query('select settings from servers where guild_id=$1', [guildId])).rows[0]
        .settings.user_report_reason_required
    ).toBeUndefined();
  });
  async function report(status = 'submitted', metadata = {}) {
    return (
      await pool.query(
        'insert into report_intakes(server_id,reporter_id,status,thread_id,confirmed_target_user_id,metadata) values($1,$2,$3,$4,$5,$6) returning id',
        [
          guildId,
          actorId,
          status,
          '444444444444444444',
          status === 'submitted' ? targetUserId : null,
          JSON.stringify(metadata),
        ]
      )
    ).rows[0].id as string;
  }
  async function item(reportId: string) {
    return (
      await pool.query(
        "insert into moderation_queue_items(server_id,user_id,item_type,report_intake_id,queue_channel_id,queue_message_id,source_thread_id) values($1,$2,'report_thread_attention',$3,'channel','message',gen_random_uuid()::text) returning id",
        [guildId, targetUserId, reportId]
      )
    ).rows[0].id as string;
  }
  it('closes submitted reports before message cleanup and reports partial cleanup failure', async () => {
    const reportId = await report();
    await item(reportId);
    queue.deleteQueueMessage.mockImplementation(async () => {
      expect(
        (await pool.query('select status from report_intakes where id=$1', [reportId])).rows[0]
          .status
      ).toBe('dismissed');
      expect((await pool.query('select * from moderation_queue_items')).rows).toHaveLength(0);
      return false;
    });
    const intent = await initial(reports, {
      workflowId: 'close_submitted_report',
      input: { reportId, action: 'dismiss_no_action' },
    });
    const result = await approvals.approve(actorId, intent.confirmationId, 'discord', guildId);
    expect(result).toMatchObject({ state: 'partial', outcome: { queueCleanupStatus: 'failed' } });
    expect(queue.deleteQueueMessage).toHaveBeenCalledTimes(1);
  });
  it('keeps attention rows when live deletion fails while independently acknowledging other items', async () => {
    const reportId = await report();
    const first = await item(reportId);
    const second = await item(reportId);
    queue.deleteQueueMessage.mockImplementation(async (row) => {
      expect(
        (await pool.query('select * from moderation_queue_items where id=$1', [row.id])).rows
      ).toHaveLength(1);
      return row.id === second;
    });
    const intent = await initial(containment, {
      workflowId: 'acknowledge_attention',
      input: { itemIds: [first, second] },
    });
    const result = await approvals.approve(actorId, intent.confirmationId, 'discord', guildId);
    expect(result.state).toBe('partial');
    expect((await pool.query('select id from moderation_queue_items')).rows).toEqual([
      { id: first },
    ]);
  });
  it('keeps report-ban claimed reports busy and terminal case opens effect-free', async () => {
    const reportId = await report('submitted', { report_ban_operation_id: 'owned-operation' });
    const intent = await initial(reports, {
      workflowId: 'close_submitted_report',
      input: { reportId, action: 'mark_actioned' },
    });
    const result = await approvals.approve(actorId, intent.confirmationId, 'discord', guildId);
    expect(result.outcome?.status).toBe('busy');
    const open = await initial(reports, {
      workflowId: 'open_submitted_report_case',
      input: { reportId },
    });
    expect(
      (await approvals.approve(actorId, open.confirmationId, 'discord', guildId)).outcome?.status
    ).toBe('busy');
    expect((await pool.query('select * from moderation_action_requests')).rows).toHaveLength(0);
    expect(queue.deleteQueueMessage).not.toHaveBeenCalled();
  });
  it('keeps submitted report case opening on its frozen queued child', async () => {
    const reportId = await report();
    await getPrismaClient().detection_events.create({
      data: {
        server_id: guildId,
        user_id: targetUserId,
        detection_type: 'user_report',
        confidence: 1,
        metadata: { reportIntakeId: reportId },
      },
    });
    const intent = await initial(reports, {
      workflowId: 'open_submitted_report_case',
      input: { reportId },
    });
    expect(intent.authorizedDelivery.kind).toBe('queued');
    const result = await approvals.approve(actorId, intent.confirmationId, 'discord', guildId);
    expect(result.state).toBe('queued');
    const saved = (
      await pool.query('select resolved from mcp_executions where id=$1', [result.executionId])
    ).rows[0].resolved;
    expect(saved.command).toEqual(intent.command);
    expect(saved.authorizedDelivery).toEqual(intent.authorizedDelivery);
    expect((await pool.query('select * from verification_events')).rows).toHaveLength(0);
  });
  it('queues report intake candidates from a verified saved binding without the web signing secret', async () => {
    const reportId = await report('needs_reporter_confirmation', {
      last_confirmation_prompt_candidate_ids: [targetUserId],
      last_confirmation_prompt_message_id: '555555555555555555',
      last_confirmation_prompt_token: 'token',
    });
    const reference = await issueChoice(reportId);
    const intent = await initial(reports, {
      workflowId: 'confirm_intake_candidate',
      input: { intakeId: reportId, targetUserId, intakePromptReference: reference },
    });
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('queued');
  });
  it('denies saved intake approval after the prompt binding changes', async () => {
    const reportId = await report('needs_reporter_confirmation', {
      last_confirmation_prompt_candidate_ids: [targetUserId],
      last_confirmation_prompt_message_id: '555555555555555555',
      last_confirmation_prompt_token: 'token',
    });
    const reference = await issueChoice(reportId);
    const intent = await initial(reports, {
      workflowId: 'confirm_intake_candidate',
      input: { intakeId: reportId, targetUserId, intakePromptReference: reference },
    });
    await pool.query(
      `update report_intakes set metadata=metadata || '{"last_confirmation_prompt_token":"changed"}' where id=$1`,
      [reportId]
    );
    expect(
      (await approvals.approve(actorId, intent.confirmationId, 'discord', guildId)).state
    ).toBe('denied');
    expect((await pool.query('select * from moderation_action_requests')).rows).toHaveLength(0);
  });
});
