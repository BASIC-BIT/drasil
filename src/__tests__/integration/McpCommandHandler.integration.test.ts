import { Pool } from 'pg';
import {
  createDelegatedActionService,
  createDelegatedAccess,
  createAlternativeApprovals,
  type DelegatedPrincipal,
  type IntentResolver,
} from '@drasil/application';
import { createDelegationStore, createActorApprovalStore } from '@drasil/application/postgres';
import { createWebDelegationDatabase } from '../../../apps/web/lib/mcp/adapters/database';
import { createBotDelegationDatabase } from '../../application/adapters/delegation';
import { getPrismaClient } from '../testDb';
jest.mock('../../../apps/web/lib/setupDataAdapter', () => ({ getPostgresPool: jest.fn() }));
const integration = process.env.JEST_INTEGRATION === '1' ? describe : describe.skip;
integration.each(['pg', 'prisma'] as const)(
  'McpCommandHandler approval authority via %s',
  (driver) => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const database = () =>
      driver === 'pg'
        ? createWebDelegationDatabase(pool)
        : createBotDelegationDatabase(getPrismaClient());
    let principal: DelegatedPrincipal;
    let store: ReturnType<typeof createDelegationStore>;
    let access: ReturnType<typeof createDelegatedAccess>;
    const enforcement = jest.fn().mockResolvedValue({ kind: 'attention_batch', items: [] });
    const resolver: IntentResolver = {
      resolve: async () => ({
        delivery: { kind: 'direct' },
        preconditions: { kind: 'none' },
        relevantState: {},
        summary: 'Acknowledge @everyone <script>😀',
        previewExpiresAt: null,
      }),
    };
    const service = () =>
      createDelegatedActionService({ store, access, resolver, direct: { execute: enforcement } });
    const alternatives = () =>
      createAlternativeApprovals({
        store: createActorApprovalStore(database()),
        access,
        service: service(),
      });
    beforeEach(async () => {
      enforcement.mockResolvedValue({ kind: 'attention_batch', items: [] });
      store = createDelegationStore(database());
      await pool.query("insert into servers(guild_id,is_active) values('guild',true)");
      const grant = await store.createConnection({
        userId: 'actor',
        clientId: 'client',
        selection: { mode: 'selected', guildIds: ['guild', 'guild-two'] },
        scopes: ['drasil:moderate'],
      });
      principal = { ...grant, grantVersion: grant.version };
      access = createDelegatedAccess({
        store,
        authority: {
          loadFresh: async (guildId, userId) => ({
            guildId,
            userId,
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
    afterAll(() => pool.end());
    async function prepare(key = 'key', guildId = 'guild') {
      // This workflow normally needs no confirmation; prepare directly to exercise alternative acceptance.
      const { createIntentService } = await import('@drasil/application');
      return createIntentService({ store, access, resolver }).prepareIntent(principal, {
        workflowId: 'acknowledge_attention',
        guildId,
        idempotencyKey: key,
        input: { itemIds: ['00000000-0000-4000-8000-000000000001'] },
      });
    }
    it('shares one execution across simultaneous approval methods', async () => {
      const intent = await prepare();
      expect((await alternatives().load('actor', intent.confirmationId, 'guild')).summary).toBe(
        intent.summary
      );
      expect(enforcement).not.toHaveBeenCalled();
      const receipts = await Promise.all([
        service().confirm(principal, intent.confirmationId, 'client_confirmation'),
        alternatives().approve('actor', intent.confirmationId, 'website'),
        alternatives().approve('actor', intent.confirmationId, 'discord', 'guild'),
      ]);
      expect(new Set(receipts.map((r) => r.executionId)).size).toBe(1);
      expect(enforcement).toHaveBeenCalledTimes(1);
      const execution = await store.loadExecution(principal, receipts[0].executionId!);
      expect(execution).toMatchObject({
        clientId: 'client',
        connectionId: principal.connectionId,
        grantVersion: 1,
      });
    });
    it('loads the exact own outcome without read scope or further effects, with visible saved context', async () => {
      enforcement.mockResolvedValue({
        kind: 'attention_batch',
        items: [
          { itemId: 'one', state: 'completed', status: 'already_handled' },
          { itemId: 'two', state: 'uncertain' },
        ],
      });
      const intent = await prepare();
      const receipt = await alternatives().approve(
        'actor',
        intent.confirmationId,
        'discord',
        'guild'
      );
      expect((await service().status(principal, receipt.executionId!)).state).toBe('denied');
      const loaded = await alternatives().load('actor', intent.confirmationId, 'guild');
      expect(loaded).toMatchObject({
        guildId: 'guild',
        clientId: 'client',
        connectionId: principal.connectionId,
        receipt: {
          state: receipt.state,
          executionId: receipt.executionId,
          outcome: receipt.outcome,
        },
      });
      const other = await prepare('other', 'guild-two');
      const otherLoaded = await alternatives().load('actor', other.confirmationId, 'guild-two');
      expect(otherLoaded.summary).toBe(loaded.summary);
      expect(otherLoaded.guildId).toBe('guild-two');
      expect(otherLoaded.receipt).toBeUndefined();
      await alternatives().load('actor', intent.confirmationId, 'guild');
      expect(enforcement).toHaveBeenCalledTimes(1);
      await expect(alternatives().load('other', intent.confirmationId, 'guild')).rejects.toThrow();
      await expect(
        alternatives().load('actor', intent.confirmationId, 'guild-two')
      ).rejects.toThrow();
      const authorize = jest
        .spyOn(access, 'authorizeWorkflow')
        .mockResolvedValue({ kind: 'denied', reason: 'permission_denied' });
      await expect(alternatives().load('actor', intent.confirmationId, 'guild')).rejects.toThrow();
      authorize.mockRestore();
      await store.revokeConnection(principal, 1);
      await expect(alternatives().load('actor', intent.confirmationId, 'guild')).rejects.toThrow();
      expect(enforcement).toHaveBeenCalledTimes(1);
    });
    it('rejects a persisted execution link with foreign ownership', async () => {
      const intent = await prepare();
      const receipt = await alternatives().approve('actor', intent.confirmationId, 'website');
      await pool.query("update mcp_executions set user_id='foreign-actor' where id=$1", [
        receipt.executionId,
      ]);
      await expect(alternatives().load('actor', intent.confirmationId, 'guild')).rejects.toThrow();
      expect(enforcement).toHaveBeenCalledTimes(1);
    });
    it('does not expose another actor or guild and rejects revoked and expired intents', async () => {
      const intent = await prepare();
      await expect(alternatives().load('other', intent.confirmationId)).rejects.toThrow();
      await expect(
        alternatives().load('actor', intent.confirmationId, 'other-guild')
      ).rejects.toThrow();
      await pool.query(
        "update mcp_intents set expires_at=now()-interval '1 second' where confirmation_id=$1",
        [intent.confirmationId]
      );
      expect(
        (await alternatives().approve('actor', intent.confirmationId, 'discord', 'guild')).state
      ).toBe('denied');
      await store.revokeConnection(principal, 1);
      await expect(alternatives().load('actor', intent.confirmationId)).rejects.toThrow();
      expect(enforcement).not.toHaveBeenCalled();
    });
    it('keeps cancelled intents inert across methods', async () => {
      const intent = await prepare();
      await alternatives().cancel('actor', intent.confirmationId, 'guild');
      expect((await alternatives().approve('actor', intent.confirmationId, 'website')).state).toBe(
        'denied'
      );
      expect(enforcement).not.toHaveBeenCalled();
    });
  }
);
