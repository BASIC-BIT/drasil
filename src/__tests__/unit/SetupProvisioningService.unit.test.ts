import { SetupProvisioningService } from '../../services/SetupProvisioningService';

describe('SetupProvisioningService (unit)', () => {
  it('leaves configured protection settings untouched when rerunning incomplete setup', async () => {
    const caseRole = { id: 'case-role', name: 'Drasil Case' };
    const verificationChannel = { id: 'verification-channel-1' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: null,
        case_role_id: caseRole.id,
        verification_channel_id: verificationChannel.id,
        settings: { detection_response_mode: 'restrict' },
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

    expect(setupWorkflowService.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({ detectionResponseMode: undefined })
    );
  });

  it('creates a new role when the wizard explicitly selected create', async () => {
    const configuredRole = { id: 'configured-role', name: 'Drasil Case' };
    const createdRole = { id: 'created-role', name: 'Drasil Case' };
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        admin_channel_id: 'admin-channel-1',
        case_role_id: configuredRole.id,
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
        cache: new Map([[configuredRole.id, configuredRole]]),
        create: jest.fn().mockResolvedValue(createdRole),
        fetch: jest.fn().mockResolvedValue(configuredRole),
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
    expect(guild.roles.create).toHaveBeenCalledWith({
      name: 'Drasil Case',
      permissions: [],
      reason: 'Drasil setup requested by web administrator admin-1',
    });
    expect(setupWorkflowService.completeSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        caseRole: createdRole,
        createdCaseRole: createdRole,
      })
    );
  });
});
