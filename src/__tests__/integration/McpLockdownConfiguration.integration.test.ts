import { Pool } from 'pg';
import { ChannelType, Collection, PermissionsBitField, type Client, type Guild } from 'discord.js';
import { mockDeep } from 'jest-mock-extended';
import {
  createAlternativeApprovals,
  createDelegatedAccess,
  createDelegatedActionService,
  createSetupIntentResolver,
  parseSetupStoredRecord,
  shippedResetChanges,
  type DelegatedScope,
} from '@drasil/application';
import { createActorApprovalStore, createDelegationStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import {
  createBotDelegationDatabase,
  createDelegatedWorkerAdmission,
} from '../../application/adapters/delegation';
import {
  createBotOperationsRuntime,
  type BotOperationsDependencies,
} from '../../application/adapters/operations';
import { createCaseConfirmationStore } from '../../application/context';
import { ConfigService } from '../../config/ConfigService';
import { ServerRepository } from '../../repositories/ServerRepository';
import { ModerationActionRequestRepository } from '../../repositories/ModerationActionRequestRepository';
import { ModerationActionRequestService } from '../../services/ModerationActionRequestService';
import { CaseRoleLockdownService } from '../../services/CaseRoleLockdownService';
import { getPrismaClient } from '../testDb';

jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
const invocation = {
  workflowId: 'apply_case_role_lockdown' as const,
  guildId: 'guild',
  idempotencyKey: 'apply',
  input: { unsyncAllowedChannels: false },
};
integration.each(['pg', 'prisma'] as const)('MCP lockdown configuration via %s', (driver) => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => pool.end());

  async function fixture(scopes: readonly DelegatedScope[], enabled: false | undefined) {
    await pool.query('insert into servers(guild_id,case_role_id,settings) values($1,$2,$3)', [
      'guild',
      'case-role',
      JSON.stringify(enabled === undefined ? {} : { case_role_lockdown_enabled: enabled }),
    ]);
    const database =
      driver === 'pg'
        ? createWebDelegationDatabase(pool)
        : createBotDelegationDatabase(getPrismaClient());
    const store = createDelegationStore(database);
    const grant = await store.createConnection({
      userId: 'actor',
      clientId: 'client',
      selection: { mode: 'selected', guildIds: ['guild'] },
      scopes,
    });
    const principal = {
      userId: grant.userId,
      clientId: grant.clientId,
      connectionId: grant.connectionId,
      grantVersion: grant.version,
      scopes: grant.scopes,
    };
    // Current administrator authority is independent of the delegated scope ceiling.
    const authority = {
      loadFresh: async () => ({
        guildId: 'guild',
        userId: 'actor',
        present: true,
        owner: false,
        permissions: '8',
        roleIds: [],
      }),
    };
    const access = createDelegatedAccess({
      store,
      authority,
      staffRoles: { loadRoleIds: async () => [] },
      guilds: {
        isActive: async () => true,
        listActive: async () => ({ guildIds: ['guild'], nextCursor: null }),
      },
    });
    const resolver = createSetupIntentResolver({
      loadServer: async () =>
        parseSetupStoredRecord(
          (await pool.query("select * from servers where guild_id='guild'")).rows[0]
        ),
      loadGuildResources: async () => ({ roles: [], channels: [] }),
      authority,
      provider: { isConfigured: () => false },
      loadHeuristicDefaults: async (scope) => shippedResetChanges(scope),
    });
    const resolve = jest.spyOn(resolver, 'resolve');
    const service = createDelegatedActionService({
      store,
      access,
      resolver,
      direct: { execute: jest.fn() },
    });
    return { database, store, principal, authority, access, service, resolve };
  }

  it('denies a moderate-only administrator before resolving, saving an intent or producing effects', async () => {
    const f = await fixture(['drasil:read', 'drasil:moderate'], false);
    expect(await f.service.submit(f.principal, invocation)).toMatchObject({
      state: 'denied',
      code: 'scope_denied',
    });
    expect(f.resolve).not.toHaveBeenCalled();
    expect(await f.access.getCapabilities(f.principal, 'guild')).toMatchObject({
      kind: 'allowed',
      capabilities: { workflows: expect.not.arrayContaining(['apply_case_role_lockdown']) },
    });
    for (const table of ['mcp_intents', 'mcp_executions', 'moderation_action_requests'])
      expect((await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n).toBe(0);
    expect(
      (await pool.query('select settings from servers')).rows[0].settings.case_role_lockdown_enabled
    ).toBe(false);
  });

  it.each([false, undefined] as const)(
    'saves the %s-to-enabled diff and confirms the real no-overwrite domain write',
    async (enabled) => {
      const f = await fixture(['drasil:read', 'drasil:configure'], enabled);
      const capabilities = await f.access.getCapabilities(f.principal, 'guild');
      expect(capabilities).toMatchObject({
        kind: 'allowed',
        capabilities: { workflows: expect.arrayContaining(['apply_case_role_lockdown']) },
      });
      const intent = await f.service.submit(f.principal, invocation);
      expect(intent.state).toBe('confirmation_required');
      const saved = (await f.store.loadIntent(f.principal, intent.confirmationId!))!;
      expect(saved.summary).toContain(
        `case_role_lockdown_enabled: ${enabled === undefined ? '(unset)' : 'false'} -> true`
      );
      expect(saved.preconditions).toMatchObject({
        kind: 'setup',
        approvedState: {
          guild_id: 'guild',
          settings: enabled === undefined ? {} : { case_role_lockdown_enabled: false },
        },
      });
      expect(
        (await pool.query('select settings from servers')).rows[0].settings
          .case_role_lockdown_enabled
      ).toBe(enabled);
      const approvals = createAlternativeApprovals({
        store: createActorApprovalStore(f.database),
        access: f.access,
        service: f.service,
      });
      expect((await approvals.load('actor', intent.confirmationId!)).summary).toBe(saved.summary);
      const receipt = await approvals.approve('actor', intent.confirmationId!, 'website');
      expect(receipt.state).toBe('queued');

      // The existing channel is already locked down, so the actual domain service must
      // persist enabled without calling either external overwrite mutation.
      const edit = jest.fn();
      const set = jest.fn();
      const channel = {
        id: 'channel',
        name: 'channel',
        type: ChannelType.GuildText,
        parentId: null,
        permissionOverwrites: {
          edit,
          set,
          cache: new Collection([
            [
              'case-role',
              {
                id: 'case-role',
                deny: new PermissionsBitField(PermissionsBitField.All),
                allow: new PermissionsBitField(0n),
              },
            ],
          ]),
        },
      };
      const guild = {
        id: 'guild',
        members: {
          me: {
            permissions: new PermissionsBitField(8n),
            roles: { highest: { comparePositionTo: () => 1 } },
          },
        },
        roles: {
          fetch: async () => ({
            id: 'case-role',
            managed: false,
            permissions: new PermissionsBitField(0n),
          }),
        },
        channels: { fetch: async () => new Collection([['channel', channel]]) },
      } as unknown as Guild;
      const client = mockDeep<Client>();
      client.guilds.fetch.mockResolvedValue(guild as never);
      const config = new ConfigService(new ServerRepository(getPrismaClient()), client);
      const confirmations = createCaseConfirmationStore();
      const operationsRuntime = createBotOperationsRuntime(
        {
          ...mockDeep<BotOperationsDependencies>(),
          client,
          configService: config,
          caseRoleLockdownService: new CaseRoleLockdownService(config),
          confirmations: confirmations.confirmations,
        },
        f.authority
      );
      const repository = new ModerationActionRequestRepository(getPrismaClient());
      const worker = new ModerationActionRequestService(
        repository,
        {
          delegation: createDelegatedWorkerAdmission({ store: f.store, access: f.access }),
          operationsRuntime,
          caseConfirmations: confirmations,
        } as never,
        mockDeep()
      );
      expect(await worker.processPendingRequests(1)).toBe(1);
      expect((await repository.findById(receipt.requestId!))?.result).toMatchObject({
        action_type: 'apply_case_role_lockdown',
        planned_writes: 0,
        applied_writes: 0,
        enabled: true,
        error_count: 0,
      });
      expect(edit).not.toHaveBeenCalled();
      expect(set).not.toHaveBeenCalled();
      expect(
        (await pool.query('select settings from servers')).rows[0].settings
          .case_role_lockdown_enabled
      ).toBe(true);
      expect((await f.service.status(f.principal, receipt.executionId!)).state).toBe('completed');
    }
  );
});
