import { SetupWorkflowService } from '../../services/SetupWorkflowService';

describe('SetupWorkflowService (unit)', () => {
  const readyReport = {
    guildId: 'guild-1',
    checkedAt: new Date('2026-08-24T12:00:00.000Z'),
    issues: [],
    errorCount: 0,
    warningCount: 0,
  };

  it('preserves detection settings when a repair omits protection mode', async () => {
    const configService = {
      getServerConfig: jest.fn(),
      updateServerConfig: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new SetupWorkflowService(
      configService,
      {} as any,
      { captureGuildEvent: jest.fn() } as any,
      { validateSetupCandidate: jest.fn().mockResolvedValue(readyReport) } as any
    );

    await expect(
      service.completeSetup({
        guild: { id: 'guild-1' } as any,
        caseRole: { id: 'role-1' } as any,
        adminChannelId: 'admin-channel-1',
        initialVerificationChannelId: 'verification-channel-1',
        candidateVerificationChannelId: 'verification-channel-1',
        reportInstructionsChannelId: null,
        candidateReport: readyReport,
      })
    ).resolves.toMatchObject({ status: 'completed' });

    expect(configService.getServerConfig).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      admin_channel_id: 'admin-channel-1',
      case_role_id: 'role-1',
      verification_channel_id: 'verification-channel-1',
    });
  });

  it('makes an explicit unified protection mode authoritative over per-event overrides', async () => {
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        settings: {
          detection_response_mode: 'restrict',
          message_detection_response_mode: 'restrict',
          join_detection_response_mode: 'record_only',
          report_enabled: true,
        },
      }),
      updateServerConfig: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new SetupWorkflowService(
      configService,
      {} as any,
      { captureGuildEvent: jest.fn() } as any,
      { validateSetupCandidate: jest.fn().mockResolvedValue(readyReport) } as any
    );

    await expect(
      service.completeSetup({
        guild: { id: 'guild-1' } as any,
        caseRole: { id: 'role-1' } as any,
        adminChannelId: 'admin-channel-1',
        initialVerificationChannelId: 'verification-channel-1',
        candidateVerificationChannelId: 'verification-channel-1',
        reportInstructionsChannelId: null,
        candidateReport: readyReport,
        detectionResponseMode: 'off',
      })
    ).resolves.toMatchObject({ status: 'completed' });

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      admin_channel_id: 'admin-channel-1',
      case_role_id: 'role-1',
      verification_channel_id: 'verification-channel-1',
      settings: {
        detection_response_mode: 'off',
        message_detection_response_mode: null,
        join_detection_response_mode: null,
        report_enabled: true,
      },
    });
  });

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
