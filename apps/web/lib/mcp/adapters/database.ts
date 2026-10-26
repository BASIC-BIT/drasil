import type { Pool, PoolClient } from 'pg';
import type {
  DelegationDatabase,
  DelegationQueryClient,
  DelegationSqlValue,
} from '@drasil/application/postgres';
import { getPostgresPool } from '../../setupDataAdapter';

function queryClient(client: Pool | PoolClient): DelegationQueryClient {
  return {
    async query<Row extends Record<string, unknown>>(
      text: string,
      values: readonly DelegationSqlValue[] = []
    ): Promise<{ rows: Row[] }> {
      const result = await client.query<Row>(text, [...values]);
      return { rows: result.rows };
    },
  };
}

export function createWebDelegationDatabase(pool: Pool = getPostgresPool()): DelegationDatabase {
  return {
    ...queryClient(pool),
    async transaction<T>(operation: (client: DelegationQueryClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const result = await operation(queryClient(client));
        await client.query('commit');
        return result;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
