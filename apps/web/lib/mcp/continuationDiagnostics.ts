import { AsyncLocalStorage } from 'node:async_hooks';
import {
  createRequestStateCodec,
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  PROTOCOL_VERSION_META_KEY,
  type RequestStateCodec,
  type RequestStateCodecOptions,
  type ServerContext,
} from '@drasil/mcp-runtime/server';
import { currentReadRequestContext } from '../readRequestContext';

type Sink = (line: string) => void;
type Stage = 'wire' | 'mint' | 'verify';
type Reason = 'none' | 'malformed' | 'mac' | 'expired' | 'bind' | 'context' | 'unknown';
const defaultSink: Sink = (line) => console.info(line);
const bindingAttempts = new AsyncLocalStorage<{ contextFailed: boolean }>();

function protocol(value: unknown) {
  switch (value) {
    case '2026-07-28':
    case '2025-11-25':
    case '2025-06-18':
    case '2025-03-26':
    case '2024-11-05':
    case '2024-10-07':
      return value;
    default:
      return 'unknown';
  }
}

function stateType(value: unknown) {
  if (value === undefined) return 'absent';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'object':
      return 'object';
    default:
      return 'other';
  }
}

function record(
  sink: Sink,
  stage: Stage,
  outcome: 'present' | 'success' | 'failure',
  reason: Reason,
  state: unknown,
  revision: () => unknown
): void {
  try {
    sink(
      JSON.stringify({
        event: 'mcp_continuation',
        stage,
        outcome,
        reason,
        correlationId: currentReadRequestContext()?.correlationId ?? 'unavailable',
        protocol: protocol(revision()),
        stateType: stateType(state),
        stateBytes:
          typeof state === 'string'
            ? Math.min(Buffer.byteLength(state), DEFAULT_MAX_REQUEST_BODY_SIZE)
            : 0,
      })
    );
  } catch {
    // Diagnostics must not change acceptance, denial or the original thrown value.
  }
}

function rejectionReason(error: unknown, contextFailed: boolean): Reason {
  if (contextFailed) return 'context';
  try {
    // The pinned SDK uses these exact opaque messages. Never read a getter or stringify errors.
    const message = error instanceof Error && Object.getOwnPropertyDescriptor(error, 'message');
    switch (message && 'value' in message ? message.value : undefined) {
      case 'malformed':
        return 'malformed';
      case 'mac':
        return 'mac';
      case 'expired':
        return 'expired';
      case 'bind':
        return 'bind';
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contextRevision(ctx: ServerContext | undefined): unknown {
  const envelope = ctx?.mcpReq.envelope;
  return object(envelope) ? envelope[PROTOCOL_VERSION_META_KEY] : undefined;
}

/** Observe only params.requestState, the wire-only field lifted by the pinned SDK. */
export function observeContinuationBody(text: string, sink: Sink = defaultSink): void {
  try {
    const body: unknown = JSON.parse(text);
    if (
      !object(body) ||
      !object(body.params) ||
      !Object.prototype.hasOwnProperty.call(body.params, 'requestState')
    )
      return;
    const state = body.params.requestState;
    const meta = body.params._meta;
    record(sink, 'wire', 'present', typeof state === 'string' ? 'none' : 'malformed', state, () =>
      object(meta) ? meta[PROTOCOL_VERSION_META_KEY] : undefined
    );
  } catch {
    // JSON acceptance and its public error remain owned by the maintained parser.
  }
}

/** Retain the maintained codec, including TTL, binding and exact thrown values. */
export function createObservedRequestStateCodec<T = unknown>(
  options: RequestStateCodecOptions,
  sink: Sink = defaultSink
): RequestStateCodec<T> {
  // Bind failures may be arbitrary thrown values; keep their category local to each operation.
  const bind = options.bind;
  const codec = createRequestStateCodec<T>({
    key: options.key,
    ttlSeconds: options.ttlSeconds,
    bind:
      bind &&
      ((ctx) => {
        try {
          return bind(ctx);
        } catch (error) {
          const attempt = bindingAttempts.getStore();
          if (attempt) attempt.contextFailed = true;
          throw error;
        }
      }),
  });
  function observe<Result>(
    stage: 'mint' | 'verify',
    ctx: ServerContext | undefined,
    work: () => Promise<Result>,
    state?: string
  ): Promise<Result> {
    const attempt = { contextFailed: false };
    return bindingAttempts.run(attempt, async () => {
      try {
        const result = await work();
        record(sink, stage, 'success', 'none', stage === 'mint' ? result : state, () =>
          contextRevision(ctx)
        );
        return result;
      } catch (error) {
        record(sink, stage, 'failure', rejectionReason(error, attempt.contextFailed), state, () =>
          contextRevision(ctx)
        );
        throw error;
      }
    });
  }
  return {
    mint: (payload, ctx) => observe('mint', ctx, () => codec.mint(payload, ctx)),
    verify: (state, ctx) => observe('verify', ctx, () => codec.verify(state, ctx), state),
  };
}
