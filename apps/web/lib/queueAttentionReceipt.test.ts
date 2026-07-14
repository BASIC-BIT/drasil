import { describe, expect, it } from 'vitest';
import {
  formatQueueAttentionAcknowledgement,
  summarizeQueueAttentionAcknowledgements,
} from './queueAttentionReceipt';

describe('queueAttentionReceipt', () => {
  it('formats single acknowledged and stale attention results accurately', () => {
    expect(
      formatQueueAttentionAcknowledgement(summarizeQueueAttentionAcknowledgements(['acknowledged']))
    ).toBe('Reply acknowledged.');
    expect(
      formatQueueAttentionAcknowledgement(
        summarizeQueueAttentionAcknowledgements(['already_handled'])
      )
    ).toBe('Reply was already handled.');
  });

  it('formats mixed bulk attention results with both counts', () => {
    const summary = summarizeQueueAttentionAcknowledgements([
      'acknowledged',
      'already_handled',
      'acknowledged',
    ]);

    expect(summary).toEqual({ acknowledgedCount: 2, alreadyHandledCount: 1 });
    expect(formatQueueAttentionAcknowledgement(summary)).toBe(
      '2 replies acknowledged; 1 already handled.'
    );
  });
});
