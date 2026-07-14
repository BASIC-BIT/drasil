import { describe, expect, it } from 'vitest';
import { isInboxActionSubmitBlocked } from './inboxActionState';

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
});
