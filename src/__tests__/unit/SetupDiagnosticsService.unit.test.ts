import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { SetupDiagnosticsService } from '../../services/SetupDiagnosticsService';

describe('SetupDiagnosticsService (unit)', () => {
  const defaultChannelHas = (permission: bigint): boolean => typeof permission === 'bigint';

  const buildConfiguredGuild = (overrides: { channelHas?: typeof defaultChannelHas } = {}) => {
    const restrictedRole = { id: 'role-1', managed: false };
    const botMember = {
      permissions: {
        has: jest.fn((permission: bigint) => permission !== PermissionFlagsBits.Administrator),
      },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(1),
        },
      },
    };
    const channel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn(overrides.channelHas ?? defaultChannelHas),
      }),
    };

    return {
      guild: {
        id: 'guild-1',
        members: {
          me: botMember,
          fetchMe: jest.fn(),
        },
        roles: {
          fetch: jest.fn().mockResolvedValue(restrictedRole),
        },
        channels: {
          fetch: jest.fn().mockResolvedValue(channel),
        },
      } as any,
      botMember,
      restrictedRole,
      channel,
    };
  };

  it('passes when configured role, channels, hierarchy, and permissions are valid', async () => {
    const { guild } = buildConfiguredGuild();
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.issues).toEqual([]);
  });

  it('reports missing required setup and recommended permissions', async () => {
    const { guild, botMember } = buildConfiguredGuild();
    botMember.permissions.has.mockReturnValue(false);
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.errorCount).toBe(4);
    expect(report.warningCount).toBe(2);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'guild-manage-roles',
        'guild-ban-members',
        'guild-view-audit-log',
        'restricted-role-missing',
        'admin-channel-missing',
        'verification-channel-missing',
      ])
    );
  });

  it('reports role hierarchy and channel permission problems', async () => {
    const { guild, botMember } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessages,
    });
    botMember.roles.highest.comparePositionTo.mockReturnValue(0);
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'restricted-role-hierarchy',
        'admin-channel-send',
        'verification-channel-send',
      ])
    );
    expect(report.errorCount).toBeGreaterThanOrEqual(3);
  });

  it('validates setup candidates that create the restricted role and verification channel', async () => {
    const { guild } = buildConfiguredGuild();
    const configService = {
      getServerConfig: jest.fn(),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateSetupCandidate(guild, {
      restrictedRoleId: null,
      willCreateRestrictedRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it('requires Manage Channels when setup will create the verification channel', async () => {
    const { guild, botMember } = buildConfiguredGuild();
    botMember.permissions.has.mockImplementation(
      (permission: bigint) =>
        permission !== PermissionFlagsBits.Administrator &&
        permission !== PermissionFlagsBits.ManageChannels
    );
    const configService = {
      getServerConfig: jest.fn(),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateSetupCandidate(guild, {
      restrictedRoleId: null,
      willCreateRestrictedRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.errorCount).toBe(1);
    expect(report.issues.map((issue) => issue.code)).toContain(
      'verification-channel-create-manage-channels'
    );
  });
});
