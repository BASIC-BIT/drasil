// Explicit legacy test-build boundary. Never imported by the release build.
import { fixtureTimestampIso } from '@/lib/e2eFixtures';
import { readFixtureReportBan } from '@/lib/reportBanFixtures';
import {
  type ModerationActionRequestDataAdapter,
  type ModerationActionRequestSummary,
} from '../../lib/moderationActionRequestDataAdapter';
export * from '../../lib/moderationActionRequestDataAdapter';

export class FixtureModerationActionRequestDataAdapter implements ModerationActionRequestDataAdapter {
  public async getRequest(
    guildId: string,
    requestId: string
  ): Promise<ModerationActionRequestSummary | null> {
    if (guildId !== 'guild-1') return null;
    return (
      (await this.listInboxRequests(guildId, 25)).find((request) => request.id === requestId) ??
      null
    );
  }
  public async getSetupRequest(
    guildId: string,
    requestId: string
  ): Promise<ModerationActionRequestSummary | null> {
    return (
      (await this.listSetupRequests(guildId, 25)).find((request) => request.id === requestId) ??
      null
    );
  }

  public async listInboxRequests(
    guildId: string,
    recentLimit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    const reportBan = await readFixtureReportBan();
    const requests = await this.listRecentRequests(guildId, recentLimit);
    return reportBan ? [reportBan, ...requests] : requests;
  }

  public async listRecentRequests(
    _guildId: string,
    _limit = 8
  ): Promise<ModerationActionRequestSummary[]> {
    return [
      {
        id: 'fixture-action-request-1',
        actionType: 'sync_moderation_queue',
        actorSurface: 'web',
        completedAt: fixtureTimestampIso,
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: fixtureTimestampIso,
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Queue sync completed.',
        status: 'completed',
        targetUserId: null,
        updatedAt: fixtureTimestampIso,
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-2',
        actionType: 'refresh_case_notification',
        actorSurface: 'web',
        completedAt: '2026-06-08T01:11:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T01:10:02.000Z',
        reportIntakeId: null,
        requestedAction: 'refresh_notification',
        resultSummary: null,
        status: 'completed',
        targetUserId: 'user-100',
        updatedAt: '2026-06-08T01:11:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-3',
        actionType: 'close_resolved_case_threads',
        actorSurface: 'web',
        completedAt: '2026-06-08T01:05:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T01:04:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Dry run found 4 closable; already closed 2; missing 1; failed 0.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T01:05:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-4',
        actionType: 'audit_case_role_lockdown',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:59:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:58:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Audit found 0 errors, 2 warnings, and 3 planned writes.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:59:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-5',
        actionType: 'intake_role_members',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:51:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:50:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Dry run Manual Intake: selected 8 of 10; skipped active 1; failed 0.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:51:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-6',
        actionType: 'complete_setup_verification',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:48:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:47:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Core setup saved; verification channel configured.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:48:02.000Z',
        verificationEventId: null,
      },
      {
        id: 'fixture-action-request-7',
        actionType: 'upsert_report_instructions',
        actorSurface: 'web',
        completedAt: '2026-06-08T00:46:02.000Z',
        detectionEventId: null,
        failedAt: null,
        lastError: null,
        messageDeletionJobId: null,
        requestedAt: '2026-06-08T00:45:02.000Z',
        reportIntakeId: null,
        requestedAction: null,
        resultSummary: 'Report instructions updated in report-channel-1.',
        status: 'completed',
        targetUserId: null,
        updatedAt: '2026-06-08T00:46:02.000Z',
        verificationEventId: null,
      },
    ];
  }

  public async listSetupRequests(
    guildId: string,
    recentLimit = 10
  ): Promise<ModerationActionRequestSummary[]> {
    return (await this.listRecentRequests(guildId, recentLimit)).filter(
      (request) => request.actionType === 'complete_setup_verification'
    );
  }

  public async listCaseRequests(
    guildId: string,
    verificationEventId: string,
    limit = 10
  ): Promise<ModerationActionRequestSummary[]> {
    return (await this.listRecentRequests(guildId, limit)).filter(
      (request) => request.verificationEventId === verificationEventId
    );
  }
}

export function createModerationActionRequestDataAdapter(): ModerationActionRequestDataAdapter {
  return new FixtureModerationActionRequestDataAdapter();
}
