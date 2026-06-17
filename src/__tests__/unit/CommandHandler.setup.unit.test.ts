import { ChannelType, MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler setup commands (unit)', () => {
  it('configures verification from typed command options for admins', async () => {
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({ updateServerConfig });

    const guild = {
      id: 'guild-1',
    } as any;

    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          if (name === 'verification-channel') {
            return { id: 'channel-2', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'role-1',
      admin_channel_id: 'channel-1',
      verification_channel_id: 'channel-2',
    });
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      updateServerConfig.mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nCase role: <@&role-1>\nAdmin channel: <#channel-1>\nVerification channel: <#channel-2>',
      allowedMentions: { parse: [] },
    });
  });

  it('auto-creates verification channel when setupverification omits it', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('created-channel-1');
    const { handler, configService } = buildHandler({ setupVerificationChannel });

    const guild = {
      id: 'guild-1',
    } as any;

    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      setupVerificationChannel.mock.invocationCallOrder[0]
    );
    expect(setupVerificationChannel).toHaveBeenCalledWith(
      guild,
      'role-1',
      false,
      expect.any(Function)
    );
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'role-1',
      admin_channel_id: 'channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nCase role: <@&role-1>\nAdmin channel: <#channel-1>\nCreated verification channel: <#created-channel-1>',
      allowedMentions: { parse: [] },
    });
  });

  it('validates setupverification against a configured verification channel when omitted', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('configured-channel-1');
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: 'configured-channel-1',
      settings: {},
    });
    const { handler, setupDiagnosticsService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      getServerConfig,
    });
    const guild = {
      id: 'guild-1',
      channels: {
        fetch: jest.fn().mockResolvedValue({
          id: 'configured-channel-1',
          type: ChannelType.GuildText,
        }),
      },
    } as any;
    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      caseRoleId: 'role-1',
      willCreateCaseRole: false,
      adminChannelId: 'channel-1',
      verificationChannelId: 'configured-channel-1',
      willCreateVerificationChannel: false,
      willSyncVerificationChannelPermissions: true,
      reportInstructionsChannelId: null,
    });
    expect(setupVerificationChannel).toHaveBeenCalledWith(
      guild,
      'role-1',
      false,
      expect.any(Function),
      'configured-channel-1'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Synced verification channel permissions: <#configured-channel-1>'
    );
  });

  it('blocks setupverification when setup diagnostics are unavailable', async () => {
    const { handler, configService, notificationManager } = buildHandler({
      setupDiagnosticsService: null,
    });
    const guild = {
      id: 'guild-1',
    } as any;
    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Setup diagnostics are not available in this runtime.',
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).not.toHaveBeenCalled();
  });

  it('rolls back a created setupverification channel when config saving fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const createdChannel = {
      id: 'created-channel-1',
      type: ChannelType.GuildText,
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const setupVerificationChannel = jest
      .fn()
      .mockImplementation(async (_guild, _roleId, _persistConfig, onChannelCreated) => {
        onChannelCreated?.('created-channel-1');
        return 'created-channel-1';
      });
    const updateServerConfig = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { handler, configService } = buildHandler({
      setupVerificationChannel,
      updateServerConfig,
    });
    const guild = {
      id: 'guild-1',
      channels: {
        cache: {
          get: jest.fn().mockReturnValue(createdChannel),
        },
        fetch: jest.fn(),
      },
    } as any;
    const interaction: any = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockImplementation(async () => {
        interaction.deferred = true;
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
      replied: false,
      deferred: false,
    };

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'role-1',
      admin_channel_id: 'channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(createdChannel.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after config save failed'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('newly created verification channel was removed'),
    });
    consoleError.mockRestore();
  });

  it('falls back to member fetch when setupverification memberPermissions is null', async () => {
    const permissionsIn = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissionsIn,
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;

    const { handler } = buildHandler();
    const interaction = {
      commandName: 'setupverification',
      guild,
      channelId: 'channel-1',
      user: { id: 'admin-1' },
      memberPermissions: null,
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          if (name === 'verification-channel') {
            return { id: 'channel-2', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith('admin-1');
    expect(permissionsIn).toHaveBeenCalledWith('channel-1');
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nCase role: <@&role-1>\nAdmin channel: <#channel-1>\nVerification channel: <#channel-2>',
      allowedMentions: { parse: [] },
    });
  });

  it('blocks setupverification when candidate diagnostics have hard errors', async () => {
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [
        {
          severity: 'error',
          code: 'case-role-hierarchy',
          message: "Drasil's highest role must be above case role <@&role-1>.",
        },
      ],
      errorCount: 1,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
    });
    const guild = {
      id: 'guild-1',
    } as any;
    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          if (name === 'verification-channel') {
            return { id: 'channel-2', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Setup not saved.'),
      allowedMentions: { parse: [] },
    });
  });

  it('surfaces rollback details when final setupverification diagnostics fail', async () => {
    const setupVerificationChannel = jest
      .fn()
      .mockImplementation(async (_guild, _roleId, _persistConfig, onChannelCreated) => {
        onChannelCreated?.('created-channel-1');
        return 'created-channel-1';
      });
    const validateSetupCandidate = jest
      .fn()
      .mockResolvedValueOnce({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [],
        errorCount: 0,
        warningCount: 0,
      })
      .mockResolvedValueOnce({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [
          {
            severity: 'error',
            code: 'verification-channel-send',
            message:
              'Drasil is missing Send Messages in verification channel <#created-channel-1>.',
          },
        ],
        errorCount: 1,
        warningCount: 0,
      });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
    });
    const createdChannel = {
      id: 'created-channel-1',
      type: ChannelType.GuildText,
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const guild = {
      id: 'guild-1',
      channels: {
        cache: {
          get: jest.fn().mockReturnValue(createdChannel),
        },
        fetch: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getRole: jest.fn().mockReturnValue({ id: 'role-1' }),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return { id: 'channel-1', type: ChannelType.GuildText };
          }
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(createdChannel.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after final validation failed'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Setup not saved.'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Final validation failed. The newly created verification channel was removed.'
    );
  });

  it('handles /config setup with an existing case role and channels', async () => {
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager, setupDiagnosticsService } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const verificationChannel = {
      id: 'verification-channel-1',
      type: ChannelType.GuildText,
    } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return adminChannel;
          }
          if (name === 'verification-channel') {
            return verificationChannel;
          }
          return null;
        }),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      caseRoleId: 'role-1',
      willCreateCaseRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: 'verification-channel-1',
      willCreateVerificationChannel: false,
      reportInstructionsChannelId: null,
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'verification-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Setup complete.'),
      allowedMentions: { parse: [] },
    });
  });

  it('validates /config setup against a configured verification channel when omitted', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('configured-channel-1');
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: 'configured-channel-1',
      settings: {},
    });
    const { handler, setupDiagnosticsService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      getServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue({
          id: 'configured-channel-1',
          type: ChannelType.GuildText,
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      caseRoleId: 'role-1',
      willCreateCaseRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: 'configured-channel-1',
      willCreateVerificationChannel: false,
      willSyncVerificationChannelPermissions: true,
      reportInstructionsChannelId: null,
    });
    expect(setupVerificationChannel).toHaveBeenCalledWith(
      guild,
      'role-1',
      false,
      expect.any(Function),
      'configured-channel-1'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Synced verification channel permissions: <#configured-channel-1>'
    );
  });

  it('handles /config setup by creating the default case role and verification channel', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('created-channel-1');
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const createdRole = { id: 'created-role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn().mockResolvedValue(createdRole),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.roles.create).toHaveBeenCalledWith({
      name: 'Drasil Case',
      permissions: [],
      reason: 'Drasil setup requested by Admin',
    });
    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
      guild,
      'created-role-1',
      false,
      expect.any(Function)
    );
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'created-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Created case role: <@&created-role-1>'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Created verification channel: <#created-channel-1>'
    );
  });

  it('reuses an existing default case role when no role is configured', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('created-channel-1');
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const getServerConfig = jest.fn().mockResolvedValue({
      case_role_id: 'missing-role-1',
      verification_channel_id: null,
      settings: {},
    });
    const { handler, configService, notificationManager, setupDiagnosticsService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
      getServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const defaultRole = { id: 'default-role-1', name: 'Drasil Case' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue(null),
        cache: new Map([['default-role-1', defaultRole]]),
        create: jest.fn(),
      },
      channels: {
        cache: new Map(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.roles.fetch).toHaveBeenCalledWith('missing-role-1');
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      caseRoleId: 'default-role-1',
      willCreateCaseRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });
    expect(notificationManager.setupVerificationChannel).toHaveBeenCalledWith(
      guild,
      'default-role-1',
      false,
      expect.any(Function)
    );
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'default-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Case role: <@&default-role-1>'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).not.toContain('Created case role');
  });

  it('honors case-role-name over a differently named configured role', async () => {
    const setupVerificationChannel = jest.fn().mockResolvedValue('created-channel-1');
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const getServerConfig = jest.fn().mockResolvedValue({
      case_role_id: 'old-role-1',
      verification_channel_id: null,
      settings: {},
    });
    const { handler, configService, setupDiagnosticsService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
      getServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const configuredRole = { id: 'old-role-1', name: 'Old Case' } as any;
    const namedRole = { id: 'named-role-1', name: 'New Case' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        fetch: jest.fn().mockResolvedValue(configuredRole),
        cache: new Map([
          ['old-role-1', configuredRole],
          ['named-role-1', namedRole],
        ]),
        create: jest.fn(),
      },
      channels: {
        cache: new Map(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn((name: string) => (name === 'case-role-name' ? 'New Case' : null)),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.roles.fetch).toHaveBeenCalledWith('old-role-1');
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      caseRoleId: 'named-role-1',
      willCreateCaseRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'named-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Case role: <@&named-role-1>');
    expect(interaction.editReply.mock.calls[0][0].content).not.toContain('<@&old-role-1>');
  });

  it('blocks /config setup when multiple verification channels are ambiguous', async () => {
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue(null),
        cache: new Map([
          [
            'verification-channel-1',
            { id: 'verification-channel-1', name: 'verification', type: ChannelType.GuildText },
          ],
          [
            'verification-channel-2',
            { id: 'verification-channel-2', name: 'verification', type: ChannelType.GuildText },
          ],
        ]),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(validateSetupCandidate).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Multiple #verification channels already exist'),
      allowedMentions: { parse: [] },
    });
  });

  it('rolls back a created case role when verification channel setup fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const setupVerificationChannel = jest.fn().mockResolvedValue(null);
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const createdRole = {
      id: 'created-role-1',
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn().mockResolvedValue(createdRole),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(createdRole.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after verification channel setup failed'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('newly created case role was removed'),
      allowedMentions: { parse: [] },
    });
    consoleError.mockRestore();
  });

  it('rolls back created setup artifacts when config saving fails', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const createdChannel = {
      id: 'created-channel-1',
      type: ChannelType.GuildText,
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const setupVerificationChannel = jest
      .fn()
      .mockImplementation(async (_guild, _roleId, _persistConfig, onChannelCreated) => {
        onChannelCreated?.('created-channel-1');
        return 'created-channel-1';
      });
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockRejectedValue(new Error('database unavailable'));
    const { handler, configService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const createdRole = {
      id: 'created-role-1',
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn().mockResolvedValue(createdRole),
      },
      channels: {
        cache: {
          get: jest.fn().mockReturnValue(createdChannel),
        },
        fetch: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'created-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(createdChannel.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after config save failed'
    );
    expect(createdRole.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after config save failed'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Configuration could not be saved.'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'newly created verification channel was removed'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'newly created case role was removed'
    );
    consoleError.mockRestore();
  });

  it('rolls back created setup artifacts when final /config setup diagnostics fail', async () => {
    const setupVerificationChannel = jest
      .fn()
      .mockImplementation(async (_guild, _roleId, _persistConfig, onChannelCreated) => {
        onChannelCreated?.('created-channel-1');
        return 'created-channel-1';
      });
    const validateSetupCandidate = jest
      .fn()
      .mockResolvedValueOnce({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [],
        errorCount: 0,
        warningCount: 0,
      })
      .mockResolvedValueOnce({
        guildId: 'guild-1',
        checkedAt: new Date('2026-01-01T00:00:00.000Z'),
        issues: [
          {
            severity: 'error',
            code: 'verification-channel-send',
            message:
              'Drasil is missing Send Messages in verification channel <#created-channel-1>.',
          },
        ],
        errorCount: 1,
        warningCount: 0,
      });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({
      setupVerificationChannel,
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const createdRole = {
      id: 'created-role-1',
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const createdChannel = {
      id: 'created-channel-1',
      type: ChannelType.GuildText,
      delete: jest.fn().mockResolvedValue(undefined),
    } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn().mockResolvedValue(createdRole),
      },
      channels: {
        cache: {
          get: jest.fn().mockReturnValue(createdChannel),
        },
        fetch: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(null),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(createdChannel.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after final validation failed'
    );
    expect(createdRole.delete).toHaveBeenCalledWith(
      'Rolling back Drasil setup after final validation failed'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Setup not saved.'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Final validation failed.');
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'The newly created verification channel was removed.'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'The newly created case role was removed.'
    );
  });

  it('keeps /config setup saved when optional report instructions fail', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [],
      errorCount: 0,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const getServerConfig = jest.fn().mockResolvedValue({ settings: {} });
    const { handler, configService } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
      updateServerSettings,
      getServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const verificationChannel = {
      id: 'verification-channel-1',
      type: ChannelType.GuildText,
    } as any;
    const reportChannel = {
      id: 'report-channel-1',
      type: ChannelType.GuildText,
      send: jest.fn().mockRejectedValue(new Error('missing embed links')),
    } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => {
          if (name === 'admin-channel') {
            return adminChannel;
          }
          if (name === 'verification-channel') {
            return verificationChannel;
          }
          if (name === 'report-channel') {
            return reportChannel;
          }
          return null;
        }),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      case_role_id: 'role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'verification-channel-1',
    });
    expect(reportChannel.send).toHaveBeenCalledTimes(1);
    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining(
        'Core setup was saved, but report instructions were not updated'
      ),
      allowedMentions: { parse: [] },
    });
    consoleError.mockRestore();
  });

  it('blocks /config setup when candidate diagnostics have hard errors', async () => {
    const validateSetupCandidate = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [
        {
          severity: 'error',
          code: 'admin-channel-send',
          message:
            'Drasil is missing Send Messages in Admin notification channel <#admin-channel-1>.',
        },
      ],
      errorCount: 1,
      warningCount: 0,
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Setup not saved.'),
      allowedMentions: { parse: [] },
    });
  });

  it('reports /config setup preflight failures after deferring', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const validateSetupCandidate = jest
      .fn()
      .mockRejectedValue(new Error('diagnostics unavailable'));
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService, notificationManager } = buildHandler({
      validateSetupCandidate,
      updateServerConfig,
    });
    const adminChannel = { id: 'admin-channel-1', type: ChannelType.GuildText } as any;
    const caseRole = { id: 'role-1' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
      roles: {
        create: jest.fn(),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1', username: 'Admin', tag: 'Admin#0001' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('setup'),
        getChannel: jest.fn((name: string) => (name === 'admin-channel' ? adminChannel : null)),
        getRole: jest.fn().mockReturnValue(caseRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Failed to complete setup. Please check permissions and try again.',
      allowedMentions: { parse: [] },
    });
    consoleError.mockRestore();
  });

  it('handles /config validate', async () => {
    const validateGuildSetup = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [
        {
          severity: 'error',
          code: 'case-role-missing',
          message: 'Case role is not configured.',
        },
        {
          severity: 'warning',
          code: 'guild-view-audit-log',
          message: 'Drasil is missing View Audit Log.',
        },
      ],
      errorCount: 1,
      warningCount: 1,
    });
    const { handler, setupDiagnosticsService } = buildHandler({ validateGuildSetup });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: {
            has: jest.fn().mockReturnValue(true),
          },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'config',
      user: { id: 'admin-1' },
      guild,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue(null),
        getSubcommand: jest.fn().mockReturnValue('validate'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(setupDiagnosticsService.validateGuildSetup).toHaveBeenCalledWith(guild);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('[ERROR] Case role is not configured.'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Setup validation failed with 1 error(s) and 1 warning(s).'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      '[WARNING] Drasil is missing View Audit Log.'
    );
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Recommended fix:');
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Run `/config setup admin-channel:<moderator-channel>` to repair core setup.'
    );
  });
});
