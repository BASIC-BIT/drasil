import type { AccessDenial } from './access';

/** Dependency-neutral read failure. Only this internal type can supply retry advice. */
export class ReadDependencyUnavailableError extends Error {
  public readonly retryAfterSeconds?: number;

  public constructor(options: { retryAfterSeconds?: number }) {
    super('Read dependency unavailable.');
    this.name = 'ReadDependencyUnavailableError';
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function toUnavailableReadDenial(error: unknown): AccessDenial {
  if (
    error instanceof ReadDependencyUnavailableError &&
    typeof error.retryAfterSeconds === 'number' &&
    Number.isFinite(error.retryAfterSeconds) &&
    error.retryAfterSeconds > 0
  ) {
    return { kind: 'denied', reason: 'unavailable', retryAfterSeconds: error.retryAfterSeconds };
  }
  return { kind: 'denied', reason: 'unavailable' };
}
