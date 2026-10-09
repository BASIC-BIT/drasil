import { context, trace } from '@opentelemetry/api';
import * as tracing from '@langfuse/tracing';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { createTracingRecorder } from '../fakes/recordingTracing';
import {
  initLangfuseTracing,
  shutdownLangfuseTracing,
  withObservation,
  recordObservation,
} from '../../observability/langfuse';

jest.mock('@langfuse/tracing', () => {
  const actual = jest.requireActual('@langfuse/tracing');
  return { ...actual, startObservation: jest.fn(actual.startObservation) };
});

jest.mock('@langfuse/otel', () => ({
  LangfuseSpanProcessor: jest.fn(() => ({
    onStart: jest.fn(),
    onEnd: jest.fn(),
    forceFlush: jest.fn(),
    shutdown: jest.fn(),
  })),
}));

describe('Langfuse failure isolation and context', () => {
  let recorder: ReturnType<typeof createTracingRecorder>;
  beforeAll(() => {
    recorder = createTracingRecorder();
  });
  afterAll(async () => {
    await shutdownLangfuseTracing();
    await recorder.shutdown();
  });
  beforeEach(() => {
    recorder.spans.length = 0;
    jest
      .mocked(tracing.startObservation)
      .mockImplementation(jest.requireActual('@langfuse/tracing').startObservation);
  });

  it('keeps concurrent generations under their own workflow through async completion', async () => {
    await Promise.all(
      ['first', 'second'].map((name) =>
        withObservation(name, 'chain', async () => {
          await Promise.all(
            ['gpt', 'jev'].map((provider) =>
              withObservation(provider, 'generation', async () => {
                await Promise.resolve();
                recordObservation('generation', { output: { verdict: 'OK' } });
              })
            )
          );
        })
      )
    );
    const roots = recorder.spans.filter((s) => ['first', 'second'].includes(s.name));
    expect(roots).toHaveLength(2);
    expect(roots[0].spanContext().traceId).not.toBe(roots[1].spanContext().traceId);
    for (const root of roots) {
      const children = recorder.spans.filter(
        (s) => s.parentSpanContext?.spanId === root.spanContext().spanId
      );
      expect(children.map((s) => s.name).sort()).toEqual(['gpt', 'jev']);
      expect(children.every((s) => s.spanContext().traceId === root.spanContext().traceId)).toBe(
        true
      );
    }
    expect(trace.getSpan(context.active())).toBeUndefined();
  });

  it('merges metadata and marks root costs partial without duplicating generation cost', async () => {
    await withObservation('root', 'chain', async () => {
      recordObservation('chain', { metadata: { detection_id: 'detection-1' } });
      await withObservation('provider', 'generation', async () => {
        recordObservation('generation', { metadata: { request_sent: true } });
        recordObservation('generation', { metadata: { cost_source: 'unknown' } });
      });
    });
    const generation = recorder.spans.find((s) => s.name === 'provider')!;
    const root = recorder.spans.find((s) => s.name === 'root')!;
    expect(generation.attributes['langfuse.observation.metadata.request_sent']).toBe('true');
    expect(generation.attributes['langfuse.observation.metadata.cost_source']).toBe('unknown');
    expect(root.attributes['langfuse.observation.metadata.cost_coverage']).toBe('partial');
    expect(root.attributes['langfuse.observation.metadata.detection_id']).toBe('detection-1');
    expect(root.attributes['langfuse.observation.cost_details']).toBeUndefined();
  });

  it('preserves application rejection and exports only a safe error category', async () => {
    const applicationError = new Error('synthetic-runtime-secret');
    const operation = jest.fn().mockRejectedValue(applicationError);
    await expect(withObservation('root', 'chain', operation)).rejects.toBe(applicationError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(recorder.spans).toHaveLength(1);
    expect(
      JSON.stringify(
        recorder.spans.map((s) => ({
          attributes: s.attributes,
          events: s.events,
          status: s.status,
        }))
      )
    ).not.toContain('synthetic-runtime-secret');
  });

  it('runs once if observation creation fails before callback entry', async () => {
    jest.mocked(tracing.startObservation).mockImplementationOnce(() => {
      throw new Error('telemetry');
    });
    const operation = jest.fn().mockResolvedValue('result');
    await expect(withObservation('root', 'chain', operation)).resolves.toBe('result');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('does not repeat side effects when ending or updating throws', async () => {
    const original = jest.requireActual<typeof tracing>('@langfuse/tracing').startObservation;
    jest
      .mocked(tracing.startObservation)
      .mockImplementationOnce((...args: Parameters<typeof tracing.startObservation>) => {
        const span = original(...args);
        span.end = () => {
          throw new Error('end');
        };
        return span;
      });
    const operation = jest.fn(async () => {
      const span = trace.getActiveSpan()!;
      jest.spyOn(span, 'setAttributes').mockImplementationOnce(() => {
        throw new Error('update');
      });
      recordObservation('chain', { output: 'done' });
      return 'result';
    });
    await expect(withObservation('root', 'chain', operation)).resolves.toBe('result');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('leaves tracing disabled on partial config without constructing a transport', () => {
    process.env.LANGFUSE_TRACING_ENABLED = 'true';
    delete process.env.LANGFUSE_PUBLIC_KEY;
    expect(initLangfuseTracing()).toBe(false);
  });

  it('bounds an exporter shutdown hang to three seconds', async () => {
    jest.useFakeTimers();
    const start = jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);
    const shutdown = jest
      .spyOn(NodeSDK.prototype, 'shutdown')
      .mockImplementation(() => new Promise(() => undefined));
    Object.assign(process.env, {
      LANGFUSE_PUBLIC_KEY: 'synthetic-public',
      LANGFUSE_SECRET_KEY: 'synthetic-secret',
      LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      LANGFUSE_TRACING_ENVIRONMENT: 'development',
    });
    expect(initLangfuseTracing()).toBe(true);
    const pending = shutdownLangfuseTracing();
    await jest.advanceTimersByTimeAsync(3000);
    await pending;
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    start.mockRestore();
    shutdown.mockRestore();
    jest.useRealTimers();
  });
});
