import type { Prisma, PrismaClient } from '../../db/prisma';
import {
  createDelegationStore,
  type DelegationDatabase,
  type DelegationQueryClient,
  type DelegationSqlValue,
} from '@drasil/application/postgres';

function queryClient(client: Prisma.TransactionClient): DelegationQueryClient {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly DelegationSqlValue[] = []
    ): Promise<{ rows: Row[] }> {
      // SQL text comes only from the shared store; all input values stay bound parameters.
      const rows = await client.$queryRawUnsafe<Row[]>(text, ...values);
      return { rows };
    },
  };
}

export function createBotDelegationDatabase(prisma: PrismaClient): DelegationDatabase {
  return {
    ...queryClient(prisma),
    transaction: (operation) => prisma.$transaction((client) => operation(queryClient(client))),
  };
}

import {
  createDelegatedAccess,
  parseQueuedRow,
  projectHumanOutcome,
  type DelegationStore,
  type DelegatedAccess,
  type WorkerAdmission,
  type DecodedQueuedAction,
  type ExecutionRecord,
} from '@drasil/application';
import type { ModerationActionRequest } from '../../repositories/types';
import type { BotCaseDependencies } from './cases';
import { createBotAuthority } from './authority';
import { getCaseResponderSettings } from '../../utils/caseResponderSettings';

export interface DelegatedWorkerRuntime {
  authorizeDelegatedRequest(
    request: ModerationActionRequest,
    recovery: boolean,
    action: DecodedQueuedAction
  ): Promise<WorkerAdmission>;
  complete(execution: ExecutionRecord, outcome: unknown): Promise<void>;
}
export function createDelegatedWorkerAdmission(deps: {
  store: DelegationStore;
  access: DelegatedAccess;
}): DelegatedWorkerRuntime {
  return {
    authorizeDelegatedRequest: (request, recovery, action) =>
      deps.store.admitQueuedExecution(
        { request: parseQueuedRow(request), action, recovery },
        (principal, execution) =>
          deps.access.authorizeWorkflow(principal, execution.guildId, execution.command)
      ),
    complete: (execution, outcome) =>
      deps.store.completeExecution(
        execution.executionId,
        projectHumanOutcome(execution.command, outcome)
      ),
  };
}
export function createBotDelegatedRuntime(
  deps: Pick<BotCaseDependencies, 'client' | 'configService'> & { prisma: PrismaClient }
): DelegatedWorkerRuntime {
  const store = createDelegationStore(createBotDelegationDatabase(deps.prisma));
  const access = createDelegatedAccess({
    store,
    authority: createBotAuthority(deps.client),
    staffRoles: {
      loadRoleIds: async (guildId) =>
        getCaseResponderSettings(
          (
            await deps.configService.getServerConfig(guildId, {
              forceRefresh: true,
              failOnReadError: true,
            })
          ).settings
        ).roleIds,
    },
    guilds: {
      isActive: async (guildId) =>
        (
          await deps.prisma.servers.findUnique({
            where: { guild_id: guildId },
            select: { is_active: true },
          })
        )?.is_active === true,
      listActive: async ({ limit, cursor }) => {
        const rows = await deps.prisma.servers.findMany({
          where: { is_active: true, ...(cursor ? { guild_id: { gt: cursor } } : {}) },
          select: { guild_id: true },
          orderBy: { guild_id: 'asc' },
          take: limit + 1,
        });
        const page = rows.slice(0, limit);
        return {
          guildIds: page.map((row) => row.guild_id),
          nextCursor: rows.length > limit ? page[page.length - 1].guild_id : null,
        };
      },
    },
  });
  return createDelegatedWorkerAdmission({ store, access });
}
