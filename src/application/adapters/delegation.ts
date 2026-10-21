import { observeNativeEnforcement } from './nativeObservation';
import type { Prisma, PrismaClient } from '../../db/prisma';
import {
  createDelegationStore,
  createNativeEnforcementStore,
  type NativeEnforcementStore,
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
  memberContextFor,
  workflowDefinitions,
  parseQueuedRow,
  projectHumanOutcome,
  type DelegationStore,
  type DelegatedAccess,
  type WorkerAdmission,
  type DecodedQueuedAction,
  type ExecutionRecord,
  type PublicActionResult,
} from '@drasil/application';
import type { ModerationActionRequest } from '../../repositories/types';
import type { BotCaseDependencies } from './cases';
import { createBotAuthority } from './authority';
import { getCaseResponderSettings } from '../../utils/caseResponderSettings';

export interface DelegatedWorkerRuntime {
  readonly native?: NativeEnforcementStore;
  reconcileNativeEnforcement?(executionId: string): Promise<PublicActionResult>;
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
  native?: NativeEnforcementStore;
}): DelegatedWorkerRuntime {
  return {
    native: deps.native,
    reconcileNativeEnforcement: deps.native?.reconcileNativeEnforcement,
    authorizeDelegatedRequest: (request, recovery, action) =>
      deps.store.admitQueuedExecution(
        { request: parseQueuedRow(request), action, recovery },
        async (principal, execution) => {
          const authority = await deps.access.authorizeWorkflow(
            principal,
            execution.guildId,
            execution.command
          );
          if (authority.kind === 'denied') return authority;
          if ('selectedMessage' in execution.command && execution.command.selectedMessage) {
            const definition = workflowDefinitions.find(
              (entry) => entry.id === execution.workflowId
            );
            const context = definition && memberContextFor(definition);
            if (!context) return { kind: 'denied', reason: 'permission_denied' };
            return deps.access.authorizeRead(principal, {
              kind: 'member_context',
              guildId: execution.guildId,
              ...context,
            });
          }
          return authority;
        }
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
  const native = createNativeEnforcementStore(createBotDelegationDatabase(deps.prisma));
  return {
    ...createDelegatedWorkerAdmission({ store, access, native }),
    reconcileNativeEnforcement: async (id) =>
      observeNativeEnforcement(deps.client, await native.reconcileNativeEnforcement(id)),
  };
}
