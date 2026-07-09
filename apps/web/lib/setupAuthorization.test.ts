import { describe, expect, it } from 'vitest';
import { assertCanUpdateAnalyticsConsent } from './setupAuthorization';

describe('assertCanUpdateAnalyticsConsent', () => {
  it('allows server owners to enable full analytics sharing', () => {
    expect(() =>
      assertCanUpdateAnalyticsConsent({
        currentLevel: 'anonymous',
        guildOwner: true,
        nextLevel: 'full',
      })
    ).not.toThrow();
  });

  it('prevents non-owners from newly enabling full analytics sharing', () => {
    expect(() =>
      assertCanUpdateAnalyticsConsent({
        currentLevel: 'anonymous',
        guildOwner: false,
        nextLevel: 'full',
      })
    ).toThrow(/Only the server owner/);
  });

  it('allows non-owners to preserve an existing full analytics setting while saving setup', () => {
    expect(() =>
      assertCanUpdateAnalyticsConsent({
        currentLevel: 'full',
        guildOwner: false,
        nextLevel: 'full',
      })
    ).not.toThrow();
  });
});
