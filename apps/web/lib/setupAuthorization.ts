import type { AnalyticsConsentLevel } from '@drasil/contracts';

export interface AnalyticsConsentAuthorizationInput {
  readonly currentLevel: AnalyticsConsentLevel | null | undefined;
  readonly guildOwner: boolean;
  readonly nextLevel: AnalyticsConsentLevel | undefined;
}

export function assertCanUpdateAnalyticsConsent(input: AnalyticsConsentAuthorizationInput): void {
  if (input.nextLevel !== 'full' || input.guildOwner || input.currentLevel === 'full') {
    return;
  }

  throw new Error(
    'Only the server owner can enable full analytics sharing because it may include raw Discord IDs.'
  );
}
