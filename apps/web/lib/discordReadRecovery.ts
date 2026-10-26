import { ReadDependencyUnavailableError } from '@drasil/application';
import { recordReadDependency, type ReadDependencyEvent } from './readDiagnostics';
import {
  createReadRecoveryBudget,
  currentReadRequestContext,
  type ReadRecoveryBudget,
} from './readRequestContext';

const INITIAL_ATTEMPT_TIMEOUT_MS = 2000;
const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

export interface DiscordReadDependencies {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

type AttemptResult<T> =
  | { kind: 'success'; value: T }
  | { kind: 'recoverable'; delayMs: number | undefined };
class AttemptTimeoutError extends Error {}

function transportFailure(error: unknown): boolean {
  if (!(error instanceof TypeError) || !('cause' in error)) return false;
  const cause = error.cause;
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    TRANSIENT_TRANSPORT_CODES.has(cause.code)
  );
}

function secondsDelay(value: unknown): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(value * 1000)
  )
    return undefined;
  return value * 1000;
}

function httpDateDelay(raw: string): number | undefined {
  // Do not let Date.parse reinterpret invalid numeric advice such as '-1'
  // as a date and allow an early retry.
  const dated =
    /^[A-Za-z]+, (?:\d{2} [A-Za-z]{3} \d{4}|\d{2}-[A-Za-z]{3}-\d{2}) \d{2}:\d{2}:\d{2} GMT$/;
  const asctime = /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/;
  if (!dated.test(raw) && !asctime.test(raw)) return undefined;
  const now = Date.now();
  // Obsolete HTTP dates use the most recent matching year no more than 50 years
  // ahead, rather than Date.parse's fixed two-digit-year cutoff.
  const latestYear = new Date(now).getUTCFullYear() + 50;
  const expanded = raw.replace(
    /-(\d{2})(?= \d{2}:\d{2}:\d{2} GMT$)/,
    (_match: string, year: string) => `-${latestYear - ((latestYear - Number(year)) % 100)}`
  );
  // The asctime HTTP-date form omits GMT but still means UTC.
  const date = Date.parse(expanded.endsWith('GMT') ? expanded : `${expanded} GMT`);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function headerDelay(response: Response): number | undefined {
  const delays = ['retry-after', 'x-ratelimit-reset-after'].flatMap((name) => {
    const raw = response.headers.get(name)?.trim();
    if (!raw) return [];
    const delay = /^\d+(?:\.\d+)?$/.test(raw)
      ? secondsDelay(Number(raw))
      : name === 'retry-after'
        ? httpDateDelay(raw)
        : undefined;
    return delay === undefined ? [] : [delay];
  });
  return delays.length ? Math.max(...delays) : undefined;
}

async function rateLimitDelay(response: Response): Promise<number | undefined> {
  const header = headerDelay(response);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const json =
    typeof body === 'object' && body !== null && 'retry_after' in body
      ? secondsDelay(body.retry_after)
      : undefined;
  if (header === undefined) return json;
  return json === undefined ? header : Math.max(header, json);
}

function cancelBody(response: Response | undefined): void {
  // A native fetch body is also cancelled by the attempt signal. This releases
  // unread error bodies; cancellation itself must never hold up recovery.
  if (response?.body) void response.body.cancel().catch(() => undefined);
}

function cancellableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const finish = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

async function attempt<T>(args: {
  input: URL;
  init: RequestInit;
  decode: (response: Response) => Promise<T>;
  fetch: typeof fetch;
  now: () => number;
  random: () => number;
  budget: ReadRecoveryBudget;
  signal: AbortSignal;
  number: number;
}): Promise<AttemptResult<T>> {
  const { signal, budget } = args;
  signal.throwIfAborted();
  const remaining = budget.remainingReadRecoveryMs();
  if (remaining <= 0) throw new ReadDependencyUnavailableError({});
  const controller = new AbortController();
  const started = args.now();
  let response: Response | undefined;
  let category: ReadDependencyEvent['category'] = 'unknown';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = (): void => undefined;
  try {
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        controller.abort(signal.reason);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(
        () => {
          const error = new AttemptTimeoutError();
          controller.abort(error);
          reject(error);
        },
        Math.min(args.number === 1 ? INITIAL_ATTEMPT_TIMEOUT_MS : remaining, remaining)
      );
    });
    const work = async (): Promise<AttemptResult<T>> => {
      response = await args.fetch(args.input, {
        ...args.init,
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (controller.signal.aborted) {
        cancelBody(response);
        controller.signal.throwIfAborted();
      }
      const status = response.status;
      category =
        status === 429
          ? 'http_rate_limited'
          : status >= 500
            ? 'http_server_error'
            : status >= 400
              ? 'http_client_error'
              : 'invalid_response';
      if (status === 429) {
        budget.startReadRecovery();
        return { kind: 'recoverable', delayMs: await rateLimitDelay(response) };
      }
      if (TRANSIENT_HTTP_STATUSES.has(status)) {
        budget.startReadRecovery();
        return { kind: 'recoverable', delayMs: headerDelay(response) ?? 100 + 150 * args.random() };
      }
      const value = await args.decode(response);
      category = 'success';
      return { kind: 'success', value };
    };
    return await Promise.race([work(), interrupted]);
  } catch (error) {
    if (signal.aborted) {
      category = 'aborted';
      throw signal.reason;
    }
    // Once Discord has supplied a non-recoverable status, a stalled error body
    // must not turn that response into a retryable transport failure.
    const nonRecoverableStatus =
      response !== undefined &&
      response.status >= 400 &&
      response.status !== 429 &&
      !TRANSIENT_HTTP_STATUSES.has(response.status);
    if (
      !nonRecoverableStatus &&
      (error instanceof AttemptTimeoutError || transportFailure(error))
    ) {
      if (!response) category = 'network';
      budget.startReadRecovery();
      return {
        kind: 'recoverable',
        delayMs: response?.status === 429 ? headerDelay(response) : 100 + 150 * args.random(),
      };
    }
    if (!response && error instanceof Error && error.name === 'AbortError') category = 'aborted';
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.abort();
    cancelBody(response);
    recordReadDependency({
      dependency: 'discord',
      category,
      status: response?.status ?? null,
      boundary: 'discord_get',
      latencyMs: args.now() - started,
      attempt: args.number,
    });
  }
}

/** GET-only recovery; action and OAuth requests must never enter this boundary. */
export async function fetchDiscordRead<T>(
  input: URL,
  init: RequestInit,
  decode: (response: Response) => Promise<T>,
  deps: DiscordReadDependencies = {}
): Promise<T> {
  if ((init.method ?? 'GET').toUpperCase() !== 'GET')
    throw new Error('Discord read recovery requires GET.');
  const context = currentReadRequestContext();
  const now = deps.now ?? (() => performance.now());
  const budget = context ?? createReadRecoveryBudget(now);
  const signals = [init.signal, context?.signal].filter(
    (signal): signal is AbortSignal => signal != null
  );
  const signal = AbortSignal.any(signals);
  const sleep = deps.sleep ?? cancellableSleep;
  for (let number = 1; number <= 2; number++) {
    const result = await attempt({
      input,
      init,
      decode,
      fetch: deps.fetch ?? fetch,
      now,
      random: deps.random ?? Math.random,
      budget,
      signal,
      number,
    });
    if (result.kind === 'success') return result.value;
    signal.throwIfAborted();
    const remaining = budget.remainingReadRecoveryMs();
    if (number === 2 || result.delayMs === undefined || result.delayMs >= remaining) {
      throw new ReadDependencyUnavailableError({
        retryAfterSeconds:
          result.delayMs === undefined || result.delayMs === 0
            ? undefined
            : Math.ceil(result.delayMs / 1000),
      });
    }
    await sleep(result.delayMs, signal);
    signal.throwIfAborted();
  }
  throw new ReadDependencyUnavailableError({});
}
