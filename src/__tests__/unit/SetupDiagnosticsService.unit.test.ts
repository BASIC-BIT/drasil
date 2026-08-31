import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { SetupDiagnosticsService } from '../../services/SetupDiagnosticsService';

describe('SetupDiagnosticsService (unit)', () => {
  const defaultChannelHas = (permission: bigint): boolean => typeof permission === 'bigint';

  const buildConfiguredGuild = (overrides: { channelHas?: typeof defaultChannelHas } = {}) => {
    const caseRole = {
      id: 'role-1',
      managed: false,
      permissions: { bitfield: 0n as bigint, has: jest.fn(() => false) },
    };
    const botMember = {
      permissions: {
        has: jest.fn((permission: bigint) => permission !== PermissionFlagsBits.Administrator),
      },
      roles: {
        cache: new Map([['bot-role', { id: 'bot-role' }]]),
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(1),
        },
      },
    };
    const channel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      permissionOverwrites: { cache: new Map() },
      permissionsFor: jest.fn((memberOrRole: unknown) => ({
        has: jest.fn(
          memberOrRole === botMember
            ? (overrides.channelHas ?? defaultChannelHas)
            : (permission: bigint) => permission !== PermissionFlagsBits.ViewChannel
        ),
      })),
    };

    return {
      guild: {
        id: 'guild-1',
        members: {
          me: botMember,
          fetchMe: jest.fn(),
        },
        roles: {
          everyone: { id: 'guild-1' },
          cache: new Map([['role-1', caseRole]]),
          fetch: jest.fn().mockResolvedValue(caseRole),
        },
        channels: {
          fetch: jest.fn().mockResolvedValue(channel),
        },
      } as any,
      botMember,
      caseRole,
      channel,
    };
  };

  it('passes when configured role, channels, hierarchy, and permissions are valid', async () => {
    const { guild } = buildConfiguredGuild();
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
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
        case_role_id: null,
        admin_channel_id: null,
        verification_channel_id: null,
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.errorCount).toBe(4);
    expect(report.warningCount).toBe(4);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'guild-manage-roles',
        'guild-ban-members',
        'guild-kick-members',
        'guild-manage-messages',
        'guild-view-audit-log',
        'case-role-missing',
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
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'case-role-hierarchy',
        'admin-channel-send',
        'verification-channel-send',
      ])
    );
    expect(report.errorCount).toBeGreaterThanOrEqual(3);
  });

  it('blocks an existing case role that grants server permissions', async () => {
    const { guild, caseRole } = buildConfiguredGuild();
    caseRole.permissions.bitfield = PermissionFlagsBits.Administrator;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.find((issue) => issue.code === 'case-role-permissions')?.severity).toBe(
      'error'
    );
    expect(report.errorCount).toBe(1);
  });

  it('rejects a case role with allow overwrites outside the verification channel', async () => {
    const { guild } = buildConfiguredGuild();
    guild.channels.cache = new Map([
      [
        'verification-channel-1',
        {
          id: 'verification-channel-1',
          permissionOverwrites: {
            cache: new Map([['role-1', { allow: { bitfield: PermissionFlagsBits.ViewChannel } }]]),
          },
        },
      ],
      [
        'staff-channel-1',
        {
          id: 'staff-channel-1',
          permissionOverwrites: {
            cache: new Map([['role-1', { allow: { bitfield: PermissionFlagsBits.ViewChannel } }]]),
          },
        },
      ],
    ]);
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues).toContainEqual({
      severity: 'error',
      code: 'case-role-channel-overwrites',
      message:
        'The case role has unmanaged channel allow permissions. Use a dedicated role that grants only Drasil-managed verification access.',
    });
  });

  it('rejects unmanaged case-role allows in the selected verification channel', async () => {
    const { guild } = buildConfiguredGuild();
    guild.channels.cache = new Map([
      [
        'verification-channel-1',
        {
          id: 'verification-channel-1',
          permissionOverwrites: {
            cache: new Map([
              [
                'role-1',
                {
                  allow: {
                    bitfield: PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ManageChannels,
                  },
                },
              ],
            ]),
          },
        },
      ],
    ]);
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    } as any;

    const report = await new SetupDiagnosticsService(configService).validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toContain('case-role-channel-overwrites');
  });

  it('rejects a setup candidate role that grants server permissions', async () => {
    const { guild, caseRole } = buildConfiguredGuild();
    caseRole.permissions.bitfield = PermissionFlagsBits.Administrator;
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: 'role-1',
      willCreateCaseRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: 'verification-channel-1',
      willCreateVerificationChannel: false,
      reportInstructionsChannelId: null,
    });

    expect(report.issues.find((issue) => issue.code === 'case-role-permissions')?.severity).toBe(
      'error'
    );
    expect(report.errorCount).toBe(1);
  });

  it('warns specifically when an admin notification channel candidate is public', async () => {
    const { guild, channel, botMember } = buildConfiguredGuild();
    channel.permissionsFor.mockImplementation((memberOrRole: unknown) => ({
      has: jest.fn(
        (permission: bigint) =>
          memberOrRole === botMember || permission === PermissionFlagsBits.ViewChannel
      ),
    }));
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.issues).toContainEqual({
      severity: 'warning',
      code: 'admin-channel-public-view',
      message:
        'Privacy: Admin notification channel <#channel-1> grants View Channel to @everyone. Every server member may be able to see moderation alerts and evidence. Review this channel or its category permissions if that access is not intentional.',
    });
    expect(report.errorCount).toBe(0);
  });

  it('warns specifically when an admin channel is visible to a non-moderator role', async () => {
    const { guild, channel } = buildConfiguredGuild();
    channel.permissionOverwrites.cache = new Map([
      [
        'ordinary-role',
        {
          id: 'ordinary-role',
          type: 0,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
    ]);
    guild.roles.fetch.mockImplementation((roleId: string) =>
      Promise.resolve(
        roleId === 'ordinary-role'
          ? { id: roleId, permissions: { has: jest.fn(() => false) } }
          : {
              id: 'role-1',
              managed: false,
              permissions: { bitfield: 0n, has: jest.fn(() => false) },
            }
      )
    );
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.issues).toContainEqual({
      severity: 'warning',
      code: 'admin-channel-non-moderator-view',
      message:
        'Privacy: Admin notification channel <#channel-1> grants View Channel to <@&ordinary-role>, which has no recognized moderator permissions. Members with that role may be able to see moderation alerts and evidence. Review this channel or its category permissions if that access is not intentional.',
    });
    expect(report.errorCount).toBe(0);
  });

  it('warns for a non-moderator role shared with the bot', async () => {
    const { guild, channel } = buildConfiguredGuild();
    channel.permissionOverwrites.cache = new Map([
      [
        'bot-role',
        {
          id: 'bot-role',
          type: 0,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
    ]);
    guild.roles.fetch.mockResolvedValue({
      id: 'bot-role',
      managed: false,
      permissions: { has: jest.fn(() => false) },
    });
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.issues).toContainEqual({
      severity: 'warning',
      code: 'admin-channel-non-moderator-view',
      message:
        'Privacy: Admin notification channel <#channel-1> grants View Channel to <@&bot-role>, which has no recognized moderator permissions. Members with that role may be able to see moderation alerts and evidence. Review this channel or its category permissions if that access is not intentional.',
    });
    expect(report.errorCount).toBe(0);
  });

  it('warns specifically for direct member access and reports every broad visibility grant', async () => {
    const { guild, channel } = buildConfiguredGuild();
    channel.permissionOverwrites.cache = new Map([
      [
        'member-1',
        {
          id: 'member-1',
          type: 1,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
      [
        'ordinary-role-1',
        {
          id: 'ordinary-role-1',
          type: 0,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
      [
        'ordinary-role-2',
        {
          id: 'ordinary-role-2',
          type: 0,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
    ]);
    guild.roles.fetch.mockImplementation((roleId: string) =>
      Promise.resolve({ id: roleId, managed: false, permissions: { has: jest.fn(() => false) } })
    );
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(
      report.issues.filter((issue) => issue.code === 'admin-channel-non-moderator-view')
    ).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining(
          'Admin notification channel <#channel-1> grants View Channel directly to <@member-1>'
        ),
      }),
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('View Channel to <@&ordinary-role-1>'),
      }),
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('View Channel to <@&ordinary-role-2>'),
      }),
    ]);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(3);
  });

  it('allows an admin channel overwrite for the bot managed role', async () => {
    const { guild, channel } = buildConfiguredGuild();
    channel.permissionOverwrites.cache = new Map([
      [
        'bot-role',
        {
          id: 'bot-role',
          type: 0,
          allow: { bitfield: PermissionFlagsBits.ViewChannel },
        },
      ],
    ]);
    guild.roles.fetch.mockResolvedValue({
      id: 'bot-role',
      managed: true,
      permissions: { has: jest.fn(() => false) },
    });
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.issues.map((issue) => issue.code)).not.toContain(
      'admin-channel-non-moderator-view'
    );
  });

  it('requires thread-send permission in configured verification channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessagesInThreads,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
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

  it('does not require private-thread permissions in optional report instructions channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessagesInThreads,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: { report_instructions_channel_id: 'report-channel-1' },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).not.toContain(
      'report-instructions-channel-send-messages-in-threads'
    );
  });

  it('reports optional report instructions delivery failures as warnings', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessages,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: { report_instructions_channel_id: 'report-channel-1' },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(
      report.issues.find((issue) => issue.code === 'report-instructions-channel-send')?.severity
    ).toBe('warning');
  });

  it('reports optional observed notification delivery failures as warnings', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.SendMessages,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: { observed_detection_notification_channel_id: 'observed-channel-1' },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(
      report.issues.find((issue) => issue.code === 'observed-notification-channel-send')?.severity
    ).toBe('warning');
    expect(report.errorCount).toBe(2);
  });

  it('requires read message history in configured verification channels', async () => {
    const { guild } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.ReadMessageHistory,
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
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
    const { guild, caseRole } = buildConfiguredGuild({
      channelHas: (permission) => permission !== PermissionFlagsBits.MentionEveryone,
    });
    const notifyRole = { id: 'notify-role-1', mentionable: false };
    guild.roles.fetch.mockImplementation((roleId: string) => {
      if (roleId === 'role-1') {
        return Promise.resolve(caseRole);
      }
      if (roleId === 'notify-role-1') {
        return Promise.resolve(notifyRole);
      }
      return Promise.resolve(null);
    });
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
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

  it('warns when manual intake is configured to use the case role', async () => {
    const { guild } = buildConfiguredGuild();
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        guild_id: 'guild-1',
        case_role_id: 'role-1',
        admin_channel_id: 'admin-channel-1',
        verification_channel_id: 'verification-channel-1',
        settings: {
          manual_intake_enabled: true,
          manual_intake_role_id: 'role-1',
        },
      }),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateGuildSetup(guild);

    expect(report.issues.map((issue) => issue.code)).toContain('manual-intake-role-is-case-role');
  });

  it('validates setup candidates that create the case role and verification channel', async () => {
    const { guild } = buildConfiguredGuild();
    const configService = {
      getServerConfig: jest.fn(),
    } as any;
    const service = new SetupDiagnosticsService(configService);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });

    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
  });

  it('does not block a setup candidate on optional report channel permissions', async () => {
    const { guild, channel } = buildConfiguredGuild();
    const reportChannel = {
      ...channel,
      id: 'report-channel-1',
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn((permission: bigint) => permission !== PermissionFlagsBits.SendMessages),
      }),
    };
    guild.channels.fetch.mockImplementation((channelId: string) =>
      Promise.resolve(channelId === 'report-channel-1' ? reportChannel : channel)
    );
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: 'report-channel-1',
    });

    expect(report.errorCount).toBe(0);
    expect(
      report.issues.find((issue) => issue.code === 'report-instructions-channel-send')?.severity
    ).toBe('warning');
  });

  it('rejects a report instructions channel that members cannot view', async () => {
    const { guild, channel, botMember } = buildConfiguredGuild();
    const reportChannel = {
      ...channel,
      id: 'report-channel-1',
      permissionsFor: jest.fn((memberOrRole: unknown) => ({
        has: jest.fn(
          (permission: bigint) =>
            memberOrRole === botMember || permission !== PermissionFlagsBits.ViewChannel
        ),
      })),
    };
    guild.channels.fetch.mockImplementation((channelId: string) =>
      Promise.resolve(channelId === 'report-channel-1' ? reportChannel : channel)
    );
    const service = new SetupDiagnosticsService({ getServerConfig: jest.fn() } as any);

    const report = await service.validateSetupCandidate(guild, {
      caseRoleId: null,
      willCreateCaseRole: true,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: 'report-channel-1',
    });

    expect(
      report.issues.find((issue) => issue.code === 'report-instructions-channel-public-view')
        ?.severity
    ).toBe('error');
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
      caseRoleId: null,
      willCreateCaseRole: true,
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
      caseRoleId: 'role-1',
      willCreateCaseRole: false,
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
