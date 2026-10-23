import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface ReadRequestContext {
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
      correlationId: randomUUID(),
      operation: options.operation,
      signal: options.signal ?? currentReadRequestContext()?.signal,
    }),
    work
  );
}
