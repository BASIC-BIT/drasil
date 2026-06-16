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
    expect(report.warningCount).toBe(3);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'guild-manage-roles',
        'guild-ban-members',
        'guild-kick-members',
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

  it('requires thread-send permission in configured verification channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessagesInThreads,
    });
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

    expect(report.issues.map((issue) => issue.code)).toContain(
      'verification-channel-send-messages-in-threads'
    );
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('requires thread permissions in configured report instructions channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessagesInThreads,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: { report_instructions_channel_id: 'report-channel-1' },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toContain(
      'report-instructions-channel-send-messages-in-threads'
    );
  });

  it('requires read message history in configured verification channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.ReadMessageHistory,
    });
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

    expect(report.issues.map((issue) => issue.code)).toContain(
      'verification-channel-read-message-history'
    );
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
  });

  it('warns for unmentionable admin notification and missing case responder roles', async () => {
    const { guild, restrictedRole } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.MentionEveryone,
    });
    const notifyRole = { id: 'notify-role-1', mentionable: false };
    guild.roles.fetch.mockImplementation((roleId: string) => {
      if (roleId === 'role-1') {
        return Promise.resolve(restrictedRole);
      }
      if (roleId === 'notify-role-1') {
        return Promise.resolve(notifyRole);
      }
      return Promise.resolve(null);
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        restricted_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        admin_notification_role_id: 'notify-role-1',
        settings: { case_responder_role_ids: ['234567890123456789'] },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['admin-notification-role-mention', 'case-responder-role-not-found'])
    );
    expect(report.warningCount).toBeGreaterThanOrEqual(2);
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

  it('requires channel-level Manage Channels when setup will sync a configured verification channel', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) =>
        permission !== PermissionFlagsBits.SendMessages &&
        permission !== PermissionFlagsBits.ManageChannels,
    });
    const configService = {
      getServerConfig: jest.fn(),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateSetupCandidate(guild, {
      restrictedRoleId: 'role-1',
      willCreateRestrictedRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: 'verification-channel-1',
      willCreateVerificationChannel: false,
      willSyncVerificationChannelPermissions: true,
      reportInstructionsChannelId: null,
    });

    expect(report.issues.map((issue) => issue.code)).toContain(
      'verification-channel-sync-manage-channels'
    );
    expect(report.issues.map((issue) => issue.code)).not.toContain('verification-channel-send');
  });
});
