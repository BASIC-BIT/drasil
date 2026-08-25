import { SetupProvisioningService } from '../../services/SetupProvisioningService';

describe('SetupProvisioningService (unit)', () => {
  it('defaults legacy first setup to notify-only without replacing surface-specific modes', async () => {
    const caseRole = { id: 'case-role', name: 'Drasil Case' };
    const verificationChannel = { id: 'verification-channel-1' };
    const configService = {
      getServerConfig: jest
        .fn()
        .mockResolvedValueOnce({
          admin_channel_id: null,
          case_role_id: caseRole.id,
          verification_channel_id: verificationChannel.id,
          settings: { detection_response_mode: 'restrict' },
        })
        .mockResolvedValueOnce({
          admin_channel_id: null,
          case_role_id: caseRole.id,
          verification_channel_id: verificationChannel.id,
          settings: {
            message_detection_response_mode: 'notify_only',
            join_detection_response_mode: 'off',
          },
        }),
    } as any;
    const setupDiagnosticsService = {
      validateSetupCandidate: jest.fn().mockResolvedValue({
        errorCount: 0,
        guildId: 'guild-1',
        issues: [],
        warningCount: 0,
      }),
    } as any;
    const setupWorkflowService = {
      completeSetup: jest.fn().mockResolvedValue({ status: 'completed' }),
    } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: caseRole as any,
        guild: { id: 'guild-1' } as any,
        verificationChannel: verificationChannel as any,
      })
    ).resolves.toEqual({ status: 'completed' });

    await expect(
      service.provision({
        actorLabel: 'administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: caseRole as any,
        guild: { id: 'guild-1' } as any,
        verificationChannel: verificationChannel as any,
      })
    ).resolves.toEqual({ status: 'completed' });

    expect(setupWorkflowService.completeSetup).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ detectionResponseMode: 'notify_only' })
    );
    expect(setupWorkflowService.completeSetup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ detectionResponseMode: undefined })
    );
  });

  it('reuses a unique matching role when the wizard allows creation', async () => {
    const matchingRole = { id: 'matching-role', name: 'Drasil Case' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        case_role_id: null,
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const setupDiagnosticsService = {
      validateSetupCandidate: jest.fn().mockResolvedValue({
        errorCount: 0,
        guildId: 'guild-1',
        issues: [],
        warningCount: 0,
      }),
    } as any;
    const setupWorkflowService = {
      completeSetup: jest.fn().mockResolvedValue({ status: 'completed' }),
    } as any;
    const guild = {
      id: 'guild-1',
      roles: {
        cache: new Map([[matchingRole.id, matchingRole]]),
        create: jest.fn(),
        fetch: jest.fn(),
      },
    } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRoleName: 'Drasil Case',
        createCaseRole: true,
        guild,
        verificationChannel: { id: 'verification-channel-1' } as any,
      })
    ).resolves.toEqual({ status: 'completed' });

    expect(guild.roles.fetch).not.toHaveBeenCalled();
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        caseRole: matchingRole,
        createdCaseRole: null,
      })
    );
  });

  it('rejects the configured manual-intake role as the case role', async () => {
    const manualIntakeRole = { id: 'manual-intake-role', name: 'Pending Investigation' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        case_role_id: 'case-role-1',
        verification_channel_id: 'verification-channel-1',
        settings: {
          manual_intake_enabled: true,
          manual_intake_role_id: manualIntakeRole.id,
        },
      }),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: manualIntakeRole as any,
        guild: { id: 'guild-1' } as any,
      })
    ).resolves.toEqual({
      status: 'invalid_selection',
      detail: 'The case role must be separate from the configured manual-intake trigger role.',
    });

    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });

  it('rejects the configured honeypot role as the case role', async () => {
    const honeypotRole = { id: '111111111111111111', name: 'New Member' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        case_role_id: 'case-role-1',
        verification_channel_id: 'verification-channel-1',
        settings: {
          role_gate_enabled: true,
          honeypot_role_id: honeypotRole.id,
        },
      }),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: honeypotRole as any,
        guild: { id: 'guild-1' } as any,
      })
    ).resolves.toEqual({
      status: 'invalid_selection',
      detail: 'The case role must be separate from the configured honeypot trigger role.',
    });

    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });

  it.each([
    [
      'member-access',
      'member_access_role_id',
      'The case role must be separate from the configured member-access role.',
    ],
    [
      'case-responder',
      'case_responder_role_ids',
      'The case role must be separate from configured case-responder roles.',
    ],
  ] as const)(
    'rejects the configured %s role as the case role',
    async (_label, setting, detail) => {
      const operationalRole = { id: '111111111111111111', name: 'Operational' };
      const configService = {
        getServerConfig: jest.fn().mockResolvedValue({
          admin_channel_id: 'admin-channel-1',
          admin_notification_role_id: null,
          case_role_id: 'case-role-1',
          verification_channel_id: 'verification-channel-1',
          settings: {
            [setting]:
              setting === 'case_responder_role_ids' ? [operationalRole.id] : operationalRole.id,
          },
        }),
      } as any;
      const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
      const setupWorkflowService = { completeSetup: jest.fn() } as any;
      const service = new SetupProvisioningService(
        configService,
        setupDiagnosticsService,
        setupWorkflowService
      );

      await expect(
        service.provision({
          actorLabel: 'web administrator admin-1',
          adminChannelId: 'admin-channel-1',
          caseRole: operationalRole as any,
          guild: { id: 'guild-1' } as any,
        })
      ).resolves.toEqual({ status: 'invalid_selection', detail });

      expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
      expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
    }
  );

  it('rejects the configured admin-notification role as the case role', async () => {
    const operationalRole = { id: '111111111111111111', name: 'Moderators' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        admin_notification_role_id: operationalRole.id,
        case_role_id: 'case-role-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: operationalRole as any,
        guild: { id: 'guild-1' } as any,
      })
    ).resolves.toEqual({
      status: 'invalid_selection',
      detail: 'The case role must be separate from the configured admin-notification role.',
    });

    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });

  it('aborts before Discord mutations when the persisted configuration cannot be read', async () => {
    const configService = {
      getServerConfig: jest.fn().mockRejectedValue(new Error('database unavailable')),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const guild = {
      id: 'guild-1',
      roles: { create: jest.fn() },
    } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        createCaseRole: true,
        guild,
      })
    ).rejects.toThrow('database unavailable');

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1', {
      failOnReadError: true,
      forceRefresh: true,
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });

  it('rejects report instructions in the resolved verification channel', async () => {
    const caseRole = { id: 'case-role-1', name: 'Drasil Case' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        case_role_id: caseRole.id,
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const guild = {
      id: 'guild-1',
      channels: {
        fetch: jest.fn().mockResolvedValue({
          id: 'verification-channel-1',
          type: 0,
        }),
      },
    } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'admin-channel-1',
        caseRole: caseRole as any,
        guild,
        reportInstructionsChannelId: 'verification-channel-1',
      })
    ).resolves.toEqual({
      status: 'invalid_selection',
      detail: 'Report instructions must use a different channel from verification.',
    });

    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });

  it('rejects the admin alert channel as the verification channel', async () => {
    const caseRole = { id: 'case-role-1', name: 'Drasil Case' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'old-admin-channel',
        case_role_id: caseRole.id,
        verification_channel_id: 'old-verification-channel',
        settings: {},
      }),
    } as any;
    const setupDiagnosticsService = { validateSetupCandidate: jest.fn() } as any;
    const setupWorkflowService = { completeSetup: jest.fn() } as any;
    const guild = {
      id: 'guild-1',
      channels: {
        fetch: jest.fn().mockResolvedValue({
          id: 'shared-channel',
          type: 0,
        }),
      },
    } as any;
    const service = new SetupProvisioningService(
      configService,
      setupDiagnosticsService,
      setupWorkflowService
    );

    await expect(
      service.provision({
        actorLabel: 'web administrator admin-1',
        adminChannelId: 'shared-channel',
        caseRole: caseRole as any,
        guild,
        verificationChannelId: 'shared-channel',
      })
    ).resolves.toEqual({
      status: 'invalid_selection',
      detail: 'The admin alert channel must be separate from the verification channel.',
    });

    expect(setupDiagnosticsService.validateSetupCandidate).not.toHaveBeenCalled();
    expect(setupWorkflowService.completeSetup).not.toHaveBeenCalled();
  });
});
