import { createMcpOperationalStore, type DelegationDatabase } from '@drasil/application/postgres';
import type { LimitSubject, LimitCategory, LimitDecision } from '@drasil/application';
import { createWebDelegationDatabase } from './adapters/database';
export type { LimitSubject, LimitCategory, LimitDecision } from '@drasil/application';
export const createMcpLimits = (database: DelegationDatabase) =>
  createMcpOperationalStore(database);
export function checkMcpLimit(
  subject: LimitSubject,
  category: LimitCategory
): Promise<LimitDecision> {
  return createMcpLimits(createWebDelegationDatabase()).checkMcpLimit(subject, category);
}

export function pruneExpiredMcpData(now: Date, limit: number): Promise<number> {
  return createMcpLimits(createWebDelegationDatabase()).pruneExpiredMcpData(now, limit);
}
