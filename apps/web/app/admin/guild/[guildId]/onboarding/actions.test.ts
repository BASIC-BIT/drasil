import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCanManageGuild: vi.fn(),
  getCurrentAdminSession: vi.fn(),
  getCurrentDiscordToken: vi.fn(),
  queueSetup: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    throw new Error(path);
  },
}));
vi.mock('@/lib/session', () => ({
  getCurrentAdminSession: mocks.getCurrentAdminSession,
  getCurrentDiscordToken: mocks.getCurrentDiscordToken,
}));
vi.mock('@/lib/setupArtifactActionQueue', () => ({
  queueCompleteSetupVerificationRequestWithReceipt: mocks.queueSetup,
}));
vi.mock('@/lib/setupDashboardService', () => ({
  createSetupDashboardService: () => ({ assertCanManageGuild: mocks.assertCanManageGuild }),
}));

import { completeOnboarding } from './actions';

describe('completeOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentAdminSession.mockResolvedValue({ userId: 'admin-1' });
    mocks.getCurrentDiscordToken.mockResolvedValue({ accessToken: 'token-1' });
    mocks.assertCanManageGuild.mockResolvedValue({ owner: true, permissions: '0' });
    mocks.queueSetup.mockResolvedValue({ id: 'request-1', status: 'queued' });
  });

  it('queues an authorized owner setup with the reviewed selections', async () => {
    const formData = new FormData();
    formData.set('adminChannelId', 'admin-channel-1');
    formData.set('caseRoleId', '__create__');
    formData.set('caseRoleName', 'Drasil Case');
    formData.set('verificationChannelId', '__auto__');
    formData.set('reportInstructionsChannelId', '__none__');
    formData.set('detectionResponseMode', 'notify_only');
    formData.set('submissionId', 'submission-1');

    const result = await completeOnboarding(
      'guild-1',
      { message: null, requestId: null, status: 'idle' },
      formData
    );

    expect(mocks.queueSetup).toHaveBeenCalledWith({
      actorId: 'admin-1',
      adminChannelId: 'admin-channel-1',
      caseRoleId: null,
      caseRoleName: 'Drasil Case',
      detectionResponseMode: 'notify_only',
      guildId: 'guild-1',
      onboardingWizard: true,
      reportInstructionsChannelId: null,
      submissionId: 'submission-1',
      verificationChannelId: null,
    });
    expect(result).toEqual({
      message: 'Setup queued. Drasil is applying and verifying it.',
      requestId: 'request-1',
      status: 'queued',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/guild/guild-1/onboarding');
  });

  it('lets an expired session reach the Discord authentication redirect', async () => {
    mocks.getCurrentAdminSession.mockResolvedValue(null);

    await expect(
      completeOnboarding(
        'guild-1',
        { message: null, requestId: null, status: 'idle' },
        new FormData()
      )
    ).rejects.toThrow('/api/auth/discord?returnTo=/admin/guild/guild-1/onboarding');
    expect(mocks.queueSetup).not.toHaveBeenCalled();
  });

  it('omits the unified protection patch when preserving per-event settings', async () => {
    const formData = new FormData();
    formData.set('adminChannelId', 'admin-channel-1');
    formData.set('caseRoleId', 'case-role-1');
    formData.set('verificationChannelId', 'verification-channel-1');
    formData.set('reportInstructionsChannelId', '__none__');
    formData.set('detectionResponseMode', '__preserve__');

    await completeOnboarding(
      'guild-1',
      { message: null, requestId: null, status: 'idle' },
      formData
    );

    expect(mocks.queueSetup).toHaveBeenCalledWith(
      expect.objectContaining({ detectionResponseMode: undefined })
    );
  });
});
