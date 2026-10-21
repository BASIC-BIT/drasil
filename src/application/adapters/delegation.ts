import type { Prisma, PrismaClient } from '../../db/prisma';
import type {
  DelegationDatabase,
  DelegationQueryClient,
  DelegationSqlValue,
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
