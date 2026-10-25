// Load the same compiled bot classes shipped in the production image. Playwright's
// transform does not implement TypeScript's legacy injection decorators.
const requireBot = require;
const { createDelegatedAccess } = require('@drasil/application');
require('reflect-metadata');

function mcpWorkerFixtures(fixtures, authority) {
  require('./owned-test-database.js').ownedTestDatabase();
  const { createPrismaClient } = requireBot('../dist/src/db/prisma.js');
  const { ModerationActionRequestRepository } = requireBot(
    '../dist/src/repositories/ModerationActionRequestRepository.js'
  );
  const { ModerationQueueRepository } = requireBot(
    '../dist/src/repositories/ModerationQueueRepository.js'
  );
  const { ModerationQueueService } = requireBot('../dist/src/services/ModerationQueueService.js');
  const { ModerationActionRequestService } = requireBot(
    '../dist/src/services/ModerationActionRequestService.js'
  );
  const { createDelegatedWorkerAdmission } = requireBot(
    '../dist/src/application/adapters/delegation.js'
  );
  const { createBotOperationsRuntime } = requireBot(
    '../dist/src/application/adapters/operations.js'
  );
  const { createCaseConfirmationStore } = requireBot('../dist/src/application/context.js');
  const prisma = createPrismaClient(process.env.TEST_DATABASE_URL);
  const configService = {
    findServerConfig: async (guildId) =>
      (await fixtures.pool.query('select * from servers where guild_id=$1', [guildId])).rows[0] ??
      null,
    getServerConfig: async (guildId) =>
      (await fixtures.pool.query('select * from servers where guild_id=$1', [guildId])).rows[0],
  };
  const client = {
    channels: {
      fetch: async (channelId) => ({
        send: async () => {
          throw new Error('Unexpected fixture send');
        },
        messages: {
          fetch: async (messageId) => ({
            delete: async () => {
              const result = await fetch(
                `http://127.0.0.1:34567/channels/${channelId}/messages/${messageId}`,
                { method: 'DELETE' }
              );
              if (!result.ok) throw new Error('Controlled Discord deletion failed');
            },
          }),
        },
      }),
    },
  };
  const queue = new ModerationQueueService(
    client,
    configService,
    {},
    {},
    {},
    new ModerationQueueRepository(prisma)
  );
  const confirmations = createCaseConfirmationStore();
  const operationsRuntime = createBotOperationsRuntime(
    {
      client,
      configService,
      queueService: queue,
      confirmations: confirmations.confirmations,
    },
    authority
  );
  const access = createDelegatedAccess({
    store: fixtures.store,
    authority,
    staffRoles: {
      loadRoleIds: async (id) =>
        (await configService.getServerConfig(id)).settings.case_responder_role_ids ?? [],
    },
    guilds: {
      isActive: async (id) =>
        !!(await fixtures.pool.query('select 1 from servers where guild_id=$1 and is_active', [id]))
          .rowCount,
      listActive: async () => ({ guildIds: [], nextCursor: null }),
    },
  });
  const worker = new ModerationActionRequestService(
    new ModerationActionRequestRepository(prisma),
    {
      operations: operationsRuntime.actions,
      operationsRuntime,
      caseConfirmations: confirmations,
      delegation: createDelegatedWorkerAdmission({ store: fixtures.store, access }),
    },
    {}
  );
  return { run: () => worker.processPendingRequests(1), stop: () => prisma.$disconnect() };
}

module.exports = { mcpWorkerFixtures };
