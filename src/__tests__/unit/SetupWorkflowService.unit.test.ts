import { SetupWorkflowService } from '../../services/SetupWorkflowService';

describe('SetupWorkflowService (unit)', () => {
  it('restores existing verification channel permissions when final validation fails', async () => {
    const restoreVerificationChannelPermissions = jest.fn().mockResolvedValue(true);
    const notificationManager = {
      setupVerificationChannel: jest
        .fn()
        .mockImplementation(
          async (
            _guild: unknown,
            _caseRoleId: string,
            _isSetupCommand: boolean,
            _onChannelCreated: unknown,
            channelId: string,
            onPermissionsUpdated: jest.Mock
          ) => {
            onPermissionsUpdated({ channelId, overwrites: [] });
            return channelId;
          }
        ),
      restoreVerificationChannelPermissions,
    } as any;
    const finalReport = {
      issues: [{ code: 'verification-channel-send', severity: 'error' as const, message: 'No' }],
      errorCount: 1,
      warningCount: 0,
    };
    const setupDiagnosticsService = {
      validateSetupCandidate: jest.fn().mockResolvedValue(finalReport),
    } as any;
    const service = new SetupWorkflowService(
      { updateServerConfig: jest.fn() } as any,
      notificationManager,
      { captureGuildEvent: jest.fn() } as any,
      setupDiagnosticsService
    );

    const result = await service.completeSetup({
      guild: { id: 'guild-1' } as any,
      caseRole: { id: 'role-1' } as any,
      adminChannelId: 'admin-channel-1',
      initialVerificationChannelId: null,
      candidateVerificationChannelId: 'verification-channel-1',
      willSyncVerificationChannelPermissions: true,
      reportInstructionsChannelId: null,
      candidateReport: {
        guildId: 'guild-1',
        checkedAt: new Date(),
        issues: [],
        errorCount: 0,
        warningCount: 0,
      },
    });

    expect(result.status).toBe('final_validation_failed');
    expect(restoreVerificationChannelPermissions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'guild-1' }),
      { channelId: 'verification-channel-1', overwrites: [] }
    );
    expect(result).toEqual(
      expect.objectContaining({
        setupFailureDetail: expect.stringContaining('permission changes were restored'),
      })
    );
  });
});
