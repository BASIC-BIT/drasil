import { context, createContextKey, trace, type Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import {
  createObservationAttributes,
  propagateAttributes,
  startObservation,
  type LangfuseObservationAttributes,
  type PropagateAttributesParams,
} from '@langfuse/tracing';
export type ObservationKind = 'chain' | 'generation' | 'retriever' | 'tool' | 'span';
const WORKFLOW_ROOT = createContextKey('drasil.workflow-root');
const SHUTDOWN_TIMEOUT_MS = 3000;
let sdk: NodeSDK | undefined;
export function initLangfuseTracing(): boolean {
  if (sdk) return true;
  if (process.env.LANGFUSE_TRACING_ENABLED !== 'true') return false;
  const {
    LANGFUSE_PUBLIC_KEY: publicKey,
    LANGFUSE_SECRET_KEY: secretKey,
    LANGFUSE_BASE_URL: baseUrl,
    LANGFUSE_TRACING_ENVIRONMENT: environment,
  } = process.env;
  try {
    const url = new URL(baseUrl ?? '');
    if (
      !publicKey?.trim() ||
      !secretKey?.trim() ||
      !environment ||
      !['development', 'production'].includes(environment) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('configuration');
    const processor = new LangfuseSpanProcessor({
      publicKey,
      secretKey,
      baseUrl,
      environment,
      release: process.env.LANGFUSE_RELEASE,
      shouldExportSpan: ({ otelSpan }) => otelSpan.attributes['drasil.observation'] === true,
    });
    const nextSdk = new NodeSDK({ spanProcessors: [processor] });
    nextSdk.start();
    sdk = nextSdk;
    return true;
  } catch {
    console.warn('[langfuse] tracing unavailable: configuration or initialization failed');
    return false;
  }
}
export async function shutdownLangfuseTracing(): Promise<void> {
  const activeSdk = sdk;
  sdk = undefined;
  if (!activeSdk) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(() => activeSdk.shutdown())
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** Telemetry must never replay an operation, including after partial SDK failure. */
export async function withObservation<T>(
  name: string,
  kind: ObservationKind,
  operation: () => Promise<T>,
  attributes?: LangfuseObservationAttributes,
  traceContext?: PropagateAttributesParams
): Promise<T> {
  let observation: ReturnType<typeof startObservation>;
  let activeContext = context.active();
  try {
    // TypeScript overload narrows the options; all native types are supported at runtime.
    observation = startObservation(name, attributes, { asType: kind as 'span' });
    observation.otelSpan.setAttribute('drasil.observation', true);
    activeContext = trace.setSpan(activeContext, observation.otelSpan);
    if (kind === 'chain' && !activeContext.getValue(WORKFLOW_ROOT))
      activeContext = activeContext.setValue(WORKFLOW_ROOT, observation.otelSpan);
  } catch {
    return operation();
  }
  let running: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    if (!running) running = Promise.resolve().then(operation);
    return running;
  };
  try {
    try {
      context.with(activeContext, () => {
        try {
          propagateAttributes({ ...traceContext, asBaggage: false }, runOnce);
        } catch {
          runOnce();
        }
      });
    } catch {
      runOnce();
    }
    return await runOnce();
  } catch (error) {
    try {
      observation.update({
        level: 'ERROR',
        statusMessage: 'application_error',
        metadata: { error_category: 'application_error' },
      });
    } catch {
      /* Preserve application exception. */
    }
    throw error;
  } finally {
    try {
      observation.end();
    } catch {
      /* Work already completed. */
    }
  }
}
export function recordObservation(
  kind: ObservationKind,
  attributes: LangfuseObservationAttributes
): void {
  try {
    trace.getActiveSpan()?.setAttributes(createObservationAttributes(kind, attributes));
    if (attributes.metadata?.cost_source === 'unknown') {
      const root = context.active().getValue(WORKFLOW_ROOT) as Span | undefined;
      root?.setAttributes(
        createObservationAttributes('chain', { metadata: { cost_coverage: 'partial' } })
      );
      root?.setAttribute('langfuse.trace.metadata.cost_coverage', 'partial');
    }
  } catch {
    /* Observability must not change moderation. */
  }
}
