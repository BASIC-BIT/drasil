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
      updateSetupConfiguration: jest.fn().mockResolvedValue(undefined),
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

    expect(configService.updateSetupConfiguration).toHaveBeenCalledWith('guild-1', {
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'role-1',
      settingsPatch: {},
      verificationChannelId: 'verification-channel-1',
    });
  });

  it('makes an explicit unified protection mode authoritative over per-event overrides', async () => {
    const configService = {
      updateSetupConfiguration: jest.fn().mockResolvedValue(undefined),
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

    expect(configService.updateSetupConfiguration).toHaveBeenCalledWith('guild-1', {
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'role-1',
      settingsPatch: {
        detection_response_mode: 'off',
        message_detection_response_mode: null,
        join_detection_response_mode: null,
      },
      verificationChannelId: 'verification-channel-1',
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

  it('saves verification permission provenance with the completed setup', async () => {
    const permissionSyncState = {
      channel_id: 'verification-channel-1',
      managed_overwrites: [
        {
          id: 'role-1',
          type: 0 as const,
          managed_bits: '1',
          original_overwrite: { existed: false, allow: '0', deny: '0' },
        },
      ],
    };
    const configService = {
      updateSetupConfiguration: jest.fn().mockResolvedValue(undefined),
    } as any;
    const notificationManager = {
      setupVerificationChannel: jest
        .fn()
        .mockImplementation(
          async (
            _guild: unknown,
            _caseRoleId: string,
            _persistConfig: boolean,
            onChannelCreated: jest.Mock
          ) => {
            onChannelCreated('verification-channel-1', permissionSyncState);
            return 'verification-channel-1';
          }
        ),
    } as any;
    const setupDiagnosticsService = {
      validateSetupCandidate: jest.fn().mockResolvedValue(readyReport),
    } as any;
    const service = new SetupWorkflowService(
      configService,
      notificationManager,
      { captureGuildEvent: jest.fn() } as any,
      setupDiagnosticsService
    );

    await expect(
      service.completeSetup({
        guild: { id: 'guild-1' } as any,
        caseRole: { id: 'role-1' } as any,
        adminChannelId: 'admin-channel-1',
        initialVerificationChannelId: null,
        candidateVerificationChannelId: null,
        reportInstructionsChannelId: null,
        candidateReport: readyReport,
      })
    ).resolves.toMatchObject({ status: 'completed' });

    expect(configService.updateSetupConfiguration).toHaveBeenCalledWith('guild-1', {
      adminChannelId: 'admin-channel-1',
      caseRoleId: 'role-1',
      settingsPatch: {
        verification_channel_permission_sync: permissionSyncState,
      },
      verificationChannelId: 'verification-channel-1',
    });
  });

  it('restores the channel recorded by permission provenance before syncing its replacement', async () => {
    const priorState = {
      channel_id: 'old-verification-channel',
      managed_overwrites: [
        {
          id: 'role-1',
          type: 0 as const,
          managed_bits: '1',
          original_overwrite: { existed: false, allow: '0', deny: '0' },
        },
      ],
    };
    const nextState = {
      channel_id: 'new-verification-channel',
      managed_overwrites: [
        {
          id: 'role-1',
          type: 0 as const,
          managed_bits: '1',
          original_overwrite: { existed: false, allow: '0', deny: '0' },
        },
      ],
    };
    const restoreManaged = jest
      .fn()
      .mockImplementation(
        async (_guild: unknown, _state: unknown, onPermissionsUpdated: jest.Mock) => {
          onPermissionsUpdated({ channelId: 'old-verification-channel', entries: [] });
          return true;
        }
      );
    const setupVerificationChannel = jest
      .fn()
      .mockImplementation(
        async (
          _guild: unknown,
          _caseRoleId: string,
          _persistConfig: boolean,
          _onChannelCreated: unknown,
          channelId: string,
          onPermissionsUpdated: jest.Mock
        ) => {
          await onPermissionsUpdated({ channelId, entries: [] }, nextState);
          return channelId;
        }
      );
    const persistPermissionSyncState = jest.fn().mockResolvedValue(undefined);
    const configService = {
      updateSetupConfiguration: jest.fn().mockResolvedValue(undefined),
    } as any;
    const service = new SetupWorkflowService(
      configService,
      {
        restoreVerificationChannelManagedPermissions: restoreManaged,
        restoreVerificationChannelPermissions: jest.fn().mockResolvedValue(true),
        setupVerificationChannel,
      } as any,
      { captureGuildEvent: jest.fn() } as any,
      { validateSetupCandidate: jest.fn().mockResolvedValue(readyReport) } as any
    );

    await expect(
      service.completeSetup({
        guild: { id: 'guild-1' } as any,
        caseRole: { id: 'role-1' } as any,
        adminChannelId: 'admin-channel-1',
        initialVerificationChannelId: null,
        candidateVerificationChannelId: 'new-verification-channel',
        previousPermissionSyncState: priorState,
        candidatePermissionSyncState: nextState,
        persistPermissionSyncState,
        willSyncVerificationChannelPermissions: true,
        reportInstructionsChannelId: null,
        candidateReport: readyReport,
      })
    ).resolves.toMatchObject({ status: 'completed' });

    expect(restoreManaged.mock.invocationCallOrder[0]).toBeLessThan(
      setupVerificationChannel.mock.invocationCallOrder[0]
    );
    expect(setupVerificationChannel).toHaveBeenCalledWith(
      expect.anything(),
      'role-1',
      false,
      expect.any(Function),
      'new-verification-channel',
      expect.any(Function),
      nextState
    );
    expect(persistPermissionSyncState).toHaveBeenCalledWith(nextState, priorState);
    expect(configService.updateSetupConfiguration).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({
        verificationChannelId: 'new-verification-channel',
        settingsPatch: { verification_channel_permission_sync: nextState },
      })
    );
  });

  it('rolls back both channels when saving a replacement verification channel fails', async () => {
    const priorState = {
      channel_id: 'old-verification-channel',
      managed_overwrites: [],
    };
    const restorePermissions = jest.fn().mockResolvedValue(true);
    const notificationManager = {
      restoreVerificationChannelManagedPermissions: jest
        .fn()
        .mockImplementation(
          async (_guild: unknown, _state: unknown, onPermissionsUpdated: jest.Mock) => {
            onPermissionsUpdated({ channelId: 'old-verification-channel', entries: [] });
            return true;
          }
        ),
      setupVerificationChannel: jest
        .fn()
        .mockImplementation(
          async (
            _guild: unknown,
            _caseRoleId: string,
            _persistConfig: boolean,
            _onChannelCreated: unknown,
            channelId: string,
            onPermissionsUpdated: jest.Mock
          ) => {
            onPermissionsUpdated(
              { channelId, entries: [] },
              { channel_id: channelId, managed_overwrites: [] }
            );
            return channelId;
          }
        ),
      restoreVerificationChannelPermissions: restorePermissions,
    } as any;
    const service = new SetupWorkflowService(
      { updateSetupConfiguration: jest.fn().mockRejectedValue(new Error('save failed')) } as any,
      notificationManager,
      { captureGuildEvent: jest.fn() } as any,
      { validateSetupCandidate: jest.fn().mockResolvedValue(readyReport) } as any
    );

    const result = await service.completeSetup({
      guild: { id: 'guild-1' } as any,
      caseRole: { id: 'role-1' } as any,
      adminChannelId: 'admin-channel-1',
      initialVerificationChannelId: null,
      candidateVerificationChannelId: 'new-verification-channel',
      previousPermissionSyncState: priorState,
      willSyncVerificationChannelPermissions: true,
      reportInstructionsChannelId: null,
      candidateReport: readyReport,
    });

    expect(result.status).toBe('config_save_failed');
    expect(restorePermissions.mock.calls.map((call) => call[1].channelId)).toEqual([
      'new-verification-channel',
      'old-verification-channel',
    ]);
  });
});
