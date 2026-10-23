import { expect, it } from 'vitest';
import { currentReadRequestContext, withReadRequestContext } from './readRequestContext';

it('isolates_parallel_read_contexts', async () => {
  const correlationIds: string[] = [];
  await Promise.all(
    ['list_cases', 'list_reports'].map((operation) =>
      withReadRequestContext({ operation }, async () => {
        const context = currentReadRequestContext()!;
        correlationIds.push(context.correlationId);
        await Promise.resolve();
        expect(currentReadRequestContext()).toBe(context);
        expect(context.operation).toBe(operation);
      })
    )
  );
  expect(new Set(correlationIds).size).toBe(2);
  expect(currentReadRequestContext()).toBeUndefined();
});

it('inherits_request_abort_without_reusing_query_state', async () => {
  const cancelled = new AbortController();
  const sibling = new AbortController();
  const correlationIds: string[] = [];
  const signals = await Promise.all(
    [cancelled, sibling].map((controller) =>
      withReadRequestContext({ operation: 'mcp_http', signal: controller.signal }, async () => {
        const parent = currentReadRequestContext()!;
        return withReadRequestContext({ operation: 'list_cases' }, async () => {
          const child = currentReadRequestContext()!;
          expect(child).not.toBe(parent);
          expect(child.correlationId).not.toBe(parent.correlationId);
          correlationIds.push(child.correlationId);
          await Promise.resolve();
          return child.signal!;
        });
      })
    )
  );
  const [cancelledSignal, siblingSignal] = signals;
  cancelled.abort();
  expect(new Set(correlationIds).size).toBe(2);
  expect(cancelledSignal.aborted).toBe(true);
  expect(siblingSignal.aborted).toBe(false);
});
