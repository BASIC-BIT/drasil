import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ queue: vi.fn() }));

vi.mock('./e2eFixtures', () => ({ isWebE2eFixtureMode: () => false }));
vi.mock('./moderationActionRequestQueue', () => ({
  queueModerationActionRequest: vi.fn(),
  queueSerializedModerationActionRequestWithReceipt: mocks.queue,
}));

import { queueCompleteSetupVerificationRequestWithReceipt } from './setupArtifactActionQueue';

describe('queueCompleteSetupVerificationRequestWithReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queue.mockResolvedValue({ id: 'request-1', status: 'queued' });
  });

  it('leaves protection mode absent for full-settings repair requests', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      actorId: 'admin-1',
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
      guildId: 'guild-1',
    });

    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({ detection_response_mode: expect.anything() }),
      })
    );
  });

  it('stores wizard selections and the stable submission id for resume', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      actorId: 'admin-1',
      adminChannelId: 'admin-channel-1',
      caseRoleId: null,
      caseRoleName: 'Review Role',
      createCaseRole: true,
      detectionResponseMode: 'record_only',
      guildId: 'guild-1',
      onboardingWizard: true,
      reportInstructionsChannelId: null,
      submissionId: 'submission-1',
      verificationChannelId: null,
    });

    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          admin_channel_id: 'admin-channel-1',
          case_role_id: null,
          case_role_name: 'Review Role',
          create_case_role: true,
          detection_response_mode: 'record_only',
          onboarding_wizard: true,
          report_instructions_channel_id: null,
          submission_id: 'submission-1',
          verification_channel_id: null,
        }),
      })
    );
  });

  it('clears a prior wizard protection selection when retrying with preserve', async () => {
    await queueCompleteSetupVerificationRequestWithReceipt({
      actorId: 'admin-1',
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'case-role-1',
      guildId: 'guild-1',
      onboardingWizard: true,
      submissionId: 'submission-1',
    });

    expect(mocks.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ detection_response_mode: null }),
      })
    );
  });
});
