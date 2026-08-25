import { describe, expect, it } from 'vitest';
import type { SetupServerRecord } from '@drasil/contracts';
import type { ModerationActionRequestSummary } from './moderationActionRequestDataAdapter';
import {
  onboardingWizardStateKey,
  resolveOnboardingDurableRequest,
  resolveOnboardingInitialState,
  resolveOnboardingInitialStep,
} from './onboardingState';

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

const availableResources = {
  channelIds: ['admin-old', 'admin-new', 'verification-old', 'report-old'],
  roleIds: ['role-old'],
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
      expect(
        resolveOnboardingInitialState(
          server,
          setupRequest(status),
          'new-submission',
          availableResources
        )
      ).toEqual({
        canPreserveProtectionModes: false,
        submissionId: 'submission-1',
        values: {
          adminChannelId: 'admin-new',
          caseRoleId: '__create__',
          caseRoleName: 'Review Role',
          detectionResponseMode: 'record_only',
          reportInstructionsChannelId: '__none__',
          verificationChannelId: '__auto__',
        },
      });
    }
  );

  it('uses persisted configuration after setup completes', () => {
    expect(
      resolveOnboardingInitialState(
        server,
        setupRequest('completed'),
        'new-submission',
        availableResources
      ).values
    ).toMatchObject({
      adminChannelId: 'admin-old',
      caseRoleId: 'role-old',
      detectionResponseMode: 'restrict',
      reportInstructionsChannelId: 'report-old',
      verificationChannelId: 'verification-old',
    });
  });

  it('preserves surface-specific protection modes during setup repair', () => {
    const serverWithOverrides: SetupServerRecord = {
      ...server,
      settings: {
        ...server.settings,
        join_detection_response_mode: 'off',
        message_detection_response_mode: 'notify_only',
      },
    };

    expect(
      resolveOnboardingInitialState(serverWithOverrides, null, 'new-submission', availableResources)
    ).toMatchObject({
      canPreserveProtectionModes: true,
      values: { detectionResponseMode: '__preserve__' },
    });
  });

  it('keeps the preserve option available when a failed request selected a unified mode', () => {
    const serverWithOverrides: SetupServerRecord = {
      ...server,
      settings: {
        ...server.settings,
        join_detection_response_mode: 'off',
        message_detection_response_mode: 'notify_only',
      },
    };

    expect(
      resolveOnboardingInitialState(
        serverWithOverrides,
        setupRequest('failed'),
        'new-submission',
        availableResources
      )
    ).toMatchObject({
      canPreserveProtectionModes: true,
      values: { detectionResponseMode: 'record_only' },
    });
  });

  it('replaces deleted persisted resources with safe wizard defaults', () => {
    expect(
      resolveOnboardingInitialState(server, null, 'new-submission', {
        channelIds: [],
        roleIds: [],
      }).values
    ).toMatchObject({
      adminChannelId: '',
      caseRoleId: '__create__',
      reportInstructionsChannelId: '__none__',
      verificationChannelId: '__auto__',
    });
  });
});

describe('resolveOnboardingDurableRequest', () => {
  it('retains an active request after core readiness becomes ready', () => {
    const request = setupRequest('processing');

    expect(resolveOnboardingDurableRequest(request, 'ready', request.id)).toBe(request);
  });

  it('retains a tracked completed receipt but hides an untracked historical completion', () => {
    const request = setupRequest('completed');

    expect(resolveOnboardingDurableRequest(request, 'ready', request.id)).toBe(request);
    expect(resolveOnboardingDurableRequest(request, 'ready', null)).toBeNull();
  });
});

describe('resolveOnboardingInitialStep', () => {
  it.each(['queued', 'processing', 'failed'] as const)(
    'resumes a %s setup request on the review and status step',
    (status) => {
      expect(resolveOnboardingInitialStep('needs_setup', setupRequest(status), 6)).toBe(6);
    }
  );

  it('starts an incomplete setup without a request at welcome', () => {
    expect(resolveOnboardingInitialStep('needs_setup', null, 6)).toBe(0);
  });
});

describe('onboardingWizardStateKey', () => {
  it('remounts only after a durable setup request reaches a terminal state', () => {
    expect(onboardingWizardStateKey(null)).toBe('onboarding-active');
    expect(onboardingWizardStateKey(setupRequest('queued'))).toBe('onboarding-active');
    expect(onboardingWizardStateKey(setupRequest('processing'))).toBe('onboarding-active');
    expect(onboardingWizardStateKey(setupRequest('completed'))).toBe('request-1:completed');
    expect(onboardingWizardStateKey(setupRequest('failed'))).toBe('request-1:failed');
  });
});
