import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const READ_RECOVERY_BUDGET_MS = 3000;

export interface ReadRecoveryBudget {
  remainingReadRecoveryMs(): number;
  startReadRecovery(): void;
}

export function createReadRecoveryBudget(
  now: () => number = () => performance.now()
): ReadRecoveryBudget {
  let deadline: number | undefined;
  return {
    remainingReadRecoveryMs: () =>
      deadline === undefined ? READ_RECOVERY_BUDGET_MS : Math.max(0, deadline - now()),
    startReadRecovery: () => {
      deadline ??= now() + READ_RECOVERY_BUDGET_MS;
    },
  };
}

export interface ReadRequestContext extends ReadRecoveryBudget {
  readonly correlationId: string;
  readonly operation: string;
  readonly signal?: AbortSignal;
}

const contexts = new AsyncLocalStorage<ReadRequestContext>();

export function currentReadRequestContext(): ReadRequestContext | undefined {
  return contexts.getStore();
}

export function withReadRequestContext<T>(
  options: { operation: string; signal?: AbortSignal },
  work: () => Promise<T>
): Promise<T> {
  return contexts.run(
    Object.freeze({
      ...createReadRecoveryBudget(),
      correlationId: randomUUID(),
      operation: options.operation,
      signal: options.signal ?? currentReadRequestContext()?.signal,
    }),
    work
  );
}
