import { describe, expect, it } from 'vitest';
import type { SetupServerRecord } from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import { resolveOnboardingInitialState } from './onboardingState';

const server: SetupServerRecord = {
  guild_id: 'guild-1',
  case_role_id: 'role-old',
  admin_channel_id: 'admin-old',
  verification_channel_id: 'verification-old',
  admin_notification_role_id: null,
  heuristic_message_threshold: 5,
  heuristic_message_timeframe_seconds: 60,
  heuristic_suspicious_keywords: [],
  created_at: null,
  updated_at: null,
  updated_by: null,
  settings: {
    detection_response_mode: 'restrict',
    report_instructions_channel_id: 'report-old',
  },
  is_active: true,
};

function setupRequest(
  status: ModerationActionRequestSummary['status']
): ModerationActionRequestSummary {
  return {
    id: 'request-1',
    actionType: 'complete_setup_verification',
    actorSurface: 'web',
    completedAt: null,
    detectionEventId: null,
    failedAt: status === 'failed' ? '2026-08-24T12:01:00.000Z' : null,
    lastError: status === 'failed' ? 'Setup failed.' : null,
    messageDeletionJobId: null,
    requestedAt: '2026-08-24T12:00:00.000Z',
    reportIntakeId: null,
    requestedAction: null,
    resultSummary: null,
    setupInput: {
      adminChannelId: 'admin-new',
      caseRoleId: null,
      caseRoleName: 'Review Role',
      detectionResponseMode: 'record_only',
      reportInstructionsChannelId: null,
      submissionId: 'submission-1',
      verificationChannelId: null,
    },
    status,
    targetUserId: null,
    updatedAt: '2026-08-24T12:01:00.000Z',
    verificationEventId: null,
  };
}

describe('resolveOnboardingInitialState', () => {
  it.each(['queued', 'processing', 'failed'] as const)(
    'restores submitted selections for a %s setup request',
    (status) => {
      expect(resolveOnboardingInitialState(server, setupRequest(status), 'new-submission')).toEqual(
        {
          submissionId: 'submission-1',
          values: {
            adminChannelId: 'admin-new',
            caseRoleId: '__create__',
            caseRoleName: 'Review Role',
            detectionResponseMode: 'record_only',
            reportInstructionsChannelId: '__none__',
            verificationChannelId: '__auto__',
          },
        }
      );
    }
  );

  it('uses persisted configuration after setup completes', () => {
    expect(
      resolveOnboardingInitialState(server, setupRequest('completed'), 'new-submission').values
    ).toMatchObject({
      adminChannelId: 'admin-old',
      caseRoleId: 'role-old',
      detectionResponseMode: 'restrict',
      reportInstructionsChannelId: 'report-old',
      verificationChannelId: 'verification-old',
    });
  });
});
