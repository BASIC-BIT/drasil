import { context, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { setLangfuseTracerProvider } from '@langfuse/tracing';
import type { ReadableSpan, SpanProcessor } from '@opentelemetry/sdk-trace-base';

export function createTracingRecorder(): {
  spans: ReadableSpan[];
  shutdown(): Promise<void>;
} {
  const spans: ReadableSpan[] = [];
  const processor: SpanProcessor = {
    onStart: () => undefined,
    onEnd: (span) => {
      spans.push(span);
    },
    forceFlush: async () => undefined,
    shutdown: async () => undefined,
  };
  const provider = new NodeTracerProvider({ spanProcessors: [processor] });
  const manager = new AsyncLocalStorageContextManager().enable();
  context.setGlobalContextManager(manager);
  setLangfuseTracerProvider(provider);
  return {
    spans,
    shutdown: async () => {
      await provider.shutdown();
      manager.disable();
      context.disable();
      trace.disable();
    },
  };
}

export function observationAttributes(span: ReadableSpan): Record<string, unknown> {
  return span.attributes as Record<string, unknown>;
}
