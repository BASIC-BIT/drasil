import type { Pool } from 'pg';
import type { AuthorityPort, DelegationStore } from '@drasil/application';
export function mcpWorkerFixtures(
  fixtures: { pool: Pool; store: DelegationStore },
  authority: AuthorityPort
): { run(): Promise<number>; stop(): Promise<void> };
