// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureTimestampIso } from '@/lib/e2eFixtures';
import {
  type OperationsIntegrityDataAdapter,
  type OperationsIntegritySnapshot,
  buildOperationsIntegritySnapshot,
} from '../../lib/operationsIntegrityDataAdapter';
export * from '../../lib/operationsIntegrityDataAdapter';

export class FixtureOperationsIntegrityDataAdapter implements OperationsIntegrityDataAdapter {
  public async getSnapshot(_guildId: string): Promise<OperationsIntegritySnapshot> {
    return buildOperationsIntegritySnapshot(
      new Date(fixtureTimestampIso),
      {
        pending_cases: 3,
        recent_resolved_cases: 2,
        case_role_members: 1,
        active_role_quarantines: 1,
        queue_items: 5,
      },
      [
        {
          severity: 'warning',
          code: 'pending_case_notification_pointer_missing',
          subject: 'case fixture-case-missing-notification',
          detail: 'Pending case does not have both notification channel and message IDs recorded.',
          user_id: 'user-200',
          verification_event_id: 'fixture-case-missing-notification',
        },
        {
          severity: 'warning',
          code: 'queue_case_mirror_not_pending',
          subject: 'queue item fixture-queue-resolved-case',
          detail: 'Case mirror references a verified verification event.',
          user_id: 'user-420',
          verification_event_id: 'fixture-case-resolved-verified',
        },
      ]
    );
  }
}

export function createOperationsIntegrityDataAdapter(): OperationsIntegrityDataAdapter {
  return new FixtureOperationsIntegrityDataAdapter();
}
