// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureTimestampIso, isWebE2eFixtureMode } from '@/lib/e2eFixtures';
import { createSetupDataAdapter } from '@/lib/setupDataAdapter';
import { SetupDashboardService } from '../../lib/setupDashboardService';
export * from '../../lib/setupDashboardService';

export function createSetupDashboardService(): SetupDashboardService {
  const clock = isWebE2eFixtureMode() ? () => new Date(fixtureTimestampIso) : undefined;
  return new SetupDashboardService(createSetupDataAdapter(), clock);
}
