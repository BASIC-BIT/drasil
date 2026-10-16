import { cookies } from 'next/headers';
import { isWebE2eFixtureMode } from './e2eFixtures';
import type {
  ModerationActionRequestSummary,
  ObservedBanResult,
} from './moderationActionRequestDataAdapter';
const cookieName = 'drasil-fixture-report-ban';
export function fixtureReportBanRequest(
  reportId: string,
  targetUserId: string,
  status: ObservedBanResult['status'] | 'queued'
): ModerationActionRequestSummary {
  const id = `fixture-report-ban-${reportId}`;
  const timestamp = '2026-10-15T00:00:00.000Z';
  return {
    id,
    actionType: 'ban_observed_detection',
    actorSurface: 'web_report',
    completedAt: status === 'banned' ? timestamp : null,
    detectionEventId: 'det-report-1',
    failedAt: null,
    lastError: null,
    messageDeletionJobId: null,
    reportIntakeId: reportId,
    requestedAction: 'ban_user',
    requestedAt: timestamp,
    resultSummary:
      status === 'banned'
        ? 'Banned.'
        : status === 'banned_updates_pending'
          ? 'Banned. Report updates are still pending.'
          : status === 'ban_outcome_unknown'
            ? 'Ban outcome needs review.'
            : 'Ban queued for Drasil.',
    status: status === 'queued' ? 'queued' : status === 'banned' ? 'completed' : 'failed',
    targetUserId,
    updatedAt: timestamp,
    verificationEventId: null,
    observedBanResult:
      status === 'queued'
        ? null
        : status === 'banned' || status === 'already_handled'
          ? { status }
          : { status, operationId: id },
  };
}
export async function queueFixtureReportBan(
  reportId: string
): Promise<{ id: string; status: 'queued' }> {
  if (!isWebE2eFixtureMode()) throw new Error('Fixture mode required.');
  (await cookies()).set(cookieName, JSON.stringify({ reportId, startedAt: Date.now() }), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/admin',
    maxAge: 120,
  });
  return { id: `fixture-report-ban-${reportId}`, status: 'queued' };
}
export async function readFixtureReportBan(): Promise<ModerationActionRequestSummary | null> {
  if (!isWebE2eFixtureMode()) return null;
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  const state: unknown = JSON.parse(value);
  if (
    !state ||
    typeof state !== 'object' ||
    !('reportId' in state) ||
    typeof state.reportId !== 'string' ||
    !('startedAt' in state) ||
    typeof state.startedAt !== 'number'
  )
    return null;
  return fixtureReportBanRequest(
    state.reportId,
    'user-300',
    Date.now() - state.startedAt >= 8000 ? 'banned' : 'queued'
  );
}
