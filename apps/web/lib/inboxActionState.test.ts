import { describe, expect, it } from 'vitest';
import {
  isInboxActionInFlight,
  isInboxActionSubmitBlocked,
  shouldUseDurableInboxActionState,
} from './inboxActionState';

describe('inboxActionState', () => {
  it('blocks queued, processing, and completed actions from duplicate submission', () => {
    expect(isInboxActionSubmitBlocked('queued')).toBe(true);
    expect(isInboxActionSubmitBlocked('processing')).toBe(true);
    expect(isInboxActionSubmitBlocked('completed')).toBe(true);
  });

  it('allows idle actions and failed actions that can be retried', () => {
    expect(isInboxActionSubmitBlocked('idle')).toBe(false);
    expect(isInboxActionSubmitBlocked('failed')).toBe(false);
  });

  it('reports only queued and processing states as in flight', () => {
    expect(isInboxActionInFlight('queued')).toBe(true);
    expect(isInboxActionInFlight('processing')).toBe(true);
    expect(isInboxActionInFlight('completed')).toBe(false);
    expect(isInboxActionInFlight('failed')).toBe(false);
  });

  it('keeps an active local retry ahead of a stale failed durable receipt', () => {
    const localState = {
      message: 'Action queued for Drasil.',
      requestId: 'request-1',
      status: 'queued' as const,
    };

    expect(
      shouldUseDurableInboxActionState(
        localState,
        { id: 'request-1', status: 'failed', updatedAt: '2026-07-14T15:00:00.000Z' },
        '2026-07-14T15:00:00.000Z'
      )
    ).toBe(false);
    expect(
      shouldUseDurableInboxActionState(
        localState,
        { id: 'request-1', status: 'processing', updatedAt: '2026-07-14T15:01:00.000Z' },
        '2026-07-14T15:00:00.000Z'
      )
    ).toBe(true);
    expect(
      shouldUseDurableInboxActionState(
        localState,
        { id: 'request-1', status: 'completed', updatedAt: '2026-07-14T15:01:00.000Z' },
        '2026-07-14T15:00:00.000Z'
      )
    ).toBe(true);
    expect(
      shouldUseDurableInboxActionState(
        localState,
        { id: 'request-1', status: 'failed', updatedAt: '2026-07-14T15:01:00.000Z' },
        '2026-07-14T15:00:00.000Z'
      )
    ).toBe(true);
  });

  it('uses durable state for the initial render but not for a different local request', () => {
    const durableRequest = {
      id: 'request-1',
      status: 'processing' as const,
      updatedAt: '2026-07-14T15:01:00.000Z',
    };

    expect(
      shouldUseDurableInboxActionState(
        { message: null, requestId: null, status: 'idle' },
        durableRequest,
        null
      )
    ).toBe(true);
    expect(
      shouldUseDurableInboxActionState(
        { message: 'Queued.', requestId: 'request-2', status: 'queued' },
        durableRequest,
        null
      )
    ).toBe(false);
  });
});
