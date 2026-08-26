import { describe, expect, it } from 'vitest';
import { buildTrackedRequestUrl } from './requestTrackingUrl';

describe('buildTrackedRequestUrl', () => {
  it('persists the exact request without dropping unrelated query parameters', () => {
    expect(
      buildTrackedRequestUrl(
        'https://drasil.example/admin/guild/guild-1/onboarding?source=dm',
        'setupRequestId',
        'request-2'
      )
    ).toBe(
      'https://drasil.example/admin/guild/guild-1/onboarding?source=dm&setupRequestId=request-2'
    );
  });
});
