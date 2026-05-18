import { MessageFlags, PermissionFlagsBits, User } from 'discord.js';
import { CommandHandler } from '../../controllers/CommandHandler';
import { SETUP_VERIFICATION_MODAL_ID } from '../../constants/setupVerificationWizard';
import {
  EXPECTED_TOPICS_SETTING_KEY,
  SERVER_ABOUT_SETTING_KEY,
  VERIFICATION_CONTEXT_SETTING_KEY,
} from '../../utils/serverContextSettings';
import { VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY } from '../../utils/verificationPromptTemplate';
import {
  VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY,
  VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY,
} from '../../utils/verificationThreadAnalysisSettings';
import {
  USER_REPORT_REASON_MAX_LENGTH,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';

describe('CommandHandler (unit)', () => {
  type HandlerOverrides = Partial<{
    banUser: jest.Mock;
    updateServerConfig: jest.Mock;
    updateServerSettings: jest.Mock;
    getCachedServerConfig: jest.Mock;
    getServerConfig: jest.Mock;
    getHeuristicSettings: jest.Mock;
    updateHeuristicSettings: jest.Mock;
    resetHeuristicSettings: jest.Mock;
    handleUserReport: jest.Mock;
  }>;

  const buildHandler = (overrides: HandlerOverrides = {}) => {
    const userModerationService = {
      banUser: overrides.banUser ?? jest.fn().mockResolvedValue(true),
    } as any;

    const configService = {
      updateServerConfig: overrides.updateServerConfig ?? jest.fn().mockResolvedValue({}),
      updateServerSettings: overrides.updateServerSettings ?? jest.fn().mockResolvedValue({}),
      getCachedServerConfig: overrides.getCachedServerConfig ?? jest.fn().mockReturnValue(null),
      getServerConfig:
        overrides.getServerConfig ??
        jest.fn().mockResolvedValue({
          settings: {},
        }),
      getHeuristicSettings:
        overrides.getHeuristicSettings ??
        jest.fn().mockResolvedValue({
          messageThreshold: 5,
          timeWindowMs: 10_000,
          suspiciousKeywords: ['free nitro'],
        }),
      updateHeuristicSettings:
        overrides.updateHeuristicSettings ??
        jest.fn().mockResolvedValue({
          messageThreshold: 5,
          timeWindowMs: 10_000,
          suspiciousKeywords: ['free nitro'],
        }),
      resetHeuristicSettings:
        overrides.resetHeuristicSettings ??
        jest.fn().mockResolvedValue({
          messageThreshold: 5,
          timeWindowMs: 10_000,
          suspiciousKeywords: ['free nitro'],
        }),
    } as any;

    const securityActionService = {
      handleUserReport: overrides.handleUserReport ?? jest.fn().mockResolvedValue(true),
    } as any;

    return {
      handler: new CommandHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        configService,
        userModerationService,
        securityActionService
      ),
      userModerationService,
      configService,
      securityActionService,
    };
  };

  it('registers /ban with default BanMembers permission', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const banCommand = commands.find((c) => c.name === 'ban');

    expect(banCommand).toBeDefined();
    expect(banCommand.default_member_permissions).toBe(PermissionFlagsBits.BanMembers.toString());
  });

  it('registers /report without default moderation permissions', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const reportCommand = commands.find((c) => c.name === 'report');

    expect(reportCommand).toBeDefined();
    expect(reportCommand.default_member_permissions).toBeUndefined();
    expect(reportCommand.options.map((option: any) => option.name)).toEqual(['user', 'reason']);
    expect(reportCommand.options.find((option: any) => option.name === 'reason').max_length).toBe(
      USER_REPORT_REASON_MAX_LENGTH
    );
  });

  it('registers /config heuristic subcommands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    expect(configCommand).toBeDefined();

    const heuristicGroup = configCommand.options.find(
      (option: any) => option.type === 2 && option.name === 'heuristic'
    );
    expect(heuristicGroup).toBeDefined();

    const heuristicSubcommands = heuristicGroup.options.map((option: any) => option.name);
    expect(heuristicSubcommands).toEqual(
      expect.arrayContaining([
        'view',
        'set-threshold',
        'set-timeframe',
        'keywords-list',
        'keywords-add',
        'keywords-remove',
        'keywords-reset',
        'reset',
      ])
    );
  });

  it('registers /config detection subcommands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    const detectionGroup = configCommand.options.find(
      (option: any) => option.type === 2 && option.name === 'detection'
    );
    expect(detectionGroup).toBeDefined();

    const detectionSubcommands = detectionGroup.options.map((option: any) => option.name);
    expect(detectionSubcommands).toEqual(
      expect.arrayContaining([
        'view',
        'set-mode',
        'set-notification-channel',
        'clear-notification-channel',
        'set-notification-threshold',
        'set-notification-window',
        'moderator-exemption-enable',
        'moderator-exemption-disable',
      ])
    );
  });

  it('registers /config report subcommands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    const reportGroup = configCommand.options.find(
      (option: any) => option.type === 2 && option.name === 'report'
    );
    expect(reportGroup).toBeDefined();

    const reportSubcommands = reportGroup.options.map((option: any) => option.name);
    expect(reportSubcommands).toEqual(
      expect.arrayContaining(['view', 'reason-require', 'reason-optional'])
    );
  });

  it('registers /config verification prompt subcommands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    expect(configCommand).toBeDefined();

    const verificationGroup = configCommand.options.find(
      (option: any) => option.type === 2 && option.name === 'verification'
    );
    expect(verificationGroup).toBeDefined();

    const verificationSubcommands = verificationGroup.options.map((option: any) => option.name);
    expect(verificationSubcommands).toEqual(
      expect.arrayContaining([
        'prompt-view',
        'prompt-set',
        'prompt-reset',
        'context-view',
        'context-set',
        'context-reset',
        'analysis-view',
        'analysis-enable',
        'analysis-disable',
        'analysis-set-limit',
      ])
    );
  });

  it('denies /ban when user lacks BanMembers permission', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const { handler, userModerationService } = buildHandler({ banUser });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;

    const guild = {
      members: {
        fetch: jest.fn().mockResolvedValue(null),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(false),
      },
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(userModerationService.banUser).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need Ban Members permission to use this command.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('falls back to permissionsIn when memberPermissions is null', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const { handler, userModerationService } = buildHandler({ banUser });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;

    const permissionsIn = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    const invokingMember = {
      permissionsIn,
    } as any;

    const guild = {
      members: {
        fetch: jest.fn().mockImplementation(async (id: string) => {
          if (id === invoker.id) return invokingMember;
          if (id === targetUser.id) return targetMember;
          return null;
        }),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      channelId: 'channel-1',
      memberPermissions: null,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reason'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(permissionsIn).toHaveBeenCalledWith('channel-1');
    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('allows /ban for users with BanMembers permission', async () => {
    const banUser = jest.fn().mockResolvedValue(true);
    const { handler, userModerationService } = buildHandler({ banUser });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;

    const guild = {
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'ban',
      user: invoker,
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reason'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
    expect(userModerationService.banUser).toHaveBeenCalledWith(targetMember, 'reason', invoker);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `User ${targetUser.tag} has been banned.`,
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /report with Discord user picker target', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleUserReport });

    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('reported reason'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      'reported reason'
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('keeps /report usable when report settings cannot be loaded', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockRejectedValue(new Error('config unavailable'));
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('   '),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user,
      undefined
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
    consoleError.mockRestore();
  });

  it('requires /report reason when configured', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'user-2', tag: 'target#0001' }),
        getString: jest.fn().mockReturnValue('   '),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Please include a reason for this report.',
    });
  });

  it('rejects /report self-reports', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn();
    const { handler, securityActionService } = buildHandler({ handleUserReport, getServerConfig });

    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn(),
      },
    } as any;

    const interaction = {
      commandName: 'report',
      user: { id: 'reporter-1' },
      guild,
      options: {
        getUser: jest.fn().mockReturnValue({ id: 'reporter-1', tag: 'reporter#0001' }),
        getString: jest.fn().mockReturnValue('self report'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(getServerConfig).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'You cannot report yourself.',
    });
  });

  it('shows setup verification modal for admins', async () => {
    const getCachedServerConfig = jest.fn().mockReturnValue({
      restricted_role_id: 'role-1',
      admin_channel_id: 'channel-1',
      verification_channel_id: 'channel-2',
    });
    const { handler, configService } = buildHandler({ getCachedServerConfig });

    const guild = {
      id: 'guild-1',
    } as any;

    const interaction = {
      commandName: 'setupverification',
      guild,
      memberPermissions: {
        has: jest.fn().mockReturnValue(true),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getCachedServerConfig).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalArg = (interaction.showModal as jest.Mock).mock.calls[0][0] as any;
    expect(modalArg.toJSON().custom_id).toBe(SETUP_VERIFICATION_MODAL_ID);
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
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith('admin-1');
    expect(permissionsIn).toHaveBeenCalledWith('channel-1');
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
  });

  it('handles /config heuristic set-threshold', async () => {
    const updateHeuristicSettings = jest.fn().mockResolvedValue({
      messageThreshold: 8,
      timeWindowMs: 10_000,
      suspiciousKeywords: ['free nitro'],
    });
    const { handler, configService } = buildHandler({ updateHeuristicSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('heuristic'),
        getSubcommand: jest.fn().mockReturnValue('set-threshold'),
        getInteger: jest.fn().mockReturnValue(8),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateHeuristicSettings).toHaveBeenCalledWith('guild-1', {
      messageThreshold: 8,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated heuristic threshold'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config detection set-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        auto_restrict: false,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('set-mode'),
        getString: jest.fn().mockReturnValue('notify_only'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      detection_response_mode: 'notify_only',
      auto_restrict: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated automatic detection response policy'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection moderator-exemption-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        automatic_detection_exempt_moderators: false,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('moderator-exemption-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      automatic_detection_exempt_moderators: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator/admin exemption: `disabled`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection moderator-exemption-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        automatic_detection_exempt_moderators: true,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('detection'),
        getSubcommand: jest.fn().mockReturnValue('moderator-exemption-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      automatic_detection_exempt_moderators: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator/admin exemption: `enabled`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config report reason-require', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('report'),
        getSubcommand: jest.fn().mockReturnValue('reason-require'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Report reason required: `yes`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification prompt-set with escaped newlines', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-set'),
        getString: jest.fn().mockReturnValue('Welcome {user_mention}\\nIn {server_name}'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      verification_prompt_template: 'Welcome {user_mention}\nIn {server_name}',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated verification prompt template'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification prompt-view', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY]: 'Welcome {user_mention}',
      },
    });
    const { handler, configService } = buildHandler({ getServerConfig });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Verification prompt template (custom):'),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Welcome {user_mention}'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification prompt-reset', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [VERIFICATION_PROMPT_TEMPLATE_SETTING_KEY]: 'custom',
        auto_restrict: true,
      },
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerConfig });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('prompt-reset'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      settings: {
        auto_restrict: true,
      },
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Reset verification prompt template to default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification context-set', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        server_about: 'A speedrunning guild',
        verification_context: 'Legitimate members often mention splits',
        expected_topics: ['doom', 'quake'],
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn((name: string) => {
          if (name === 'server-about') return 'A speedrunning guild';
          if (name === 'verification-context') return 'Legitimate members often mention splits';
          if (name === 'expected-topics') return 'doom, quake';
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [SERVER_ABOUT_SETTING_KEY]: 'A speedrunning guild',
      [VERIFICATION_CONTEXT_SETTING_KEY]: 'Legitimate members often mention splits',
      [EXPECTED_TOPICS_SETTING_KEY]: ['doom', 'quake'],
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated AI server context'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config verification context-view and truncates oversized previews', async () => {
    const longLine = 'A'.repeat(1200);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [SERVER_ABOUT_SETTING_KEY]: `${longLine}\n${longLine}`,
        [VERIFICATION_CONTEXT_SETTING_KEY]: `${longLine}\n${longLine}`,
        [EXPECTED_TOPICS_SETTING_KEY]: ['doom', 'quake'],
      },
    });
    const { handler } = buildHandler({ getServerConfig });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    const reply = interaction.reply.mock.calls[0][0];
    expect(reply.content).toContain('Current AI server context');
    expect(reply.content).toContain('... (truncated ');
    expect(reply.content.length).toBeLessThanOrEqual(2000);
    expect(reply.flags).toBe(MessageFlags.Ephemeral);
    expect(reply.allowedMentions).toEqual({ parse: [] });
  });

  it('rejects /config verification context-set with no values', async () => {
    const { handler, configService } = buildHandler();

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Provide at least one server context field to update.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects /config verification context-set when expected-topics contains only delimiters', async () => {
    const { handler, configService } = buildHandler();

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-set'),
        getString: jest.fn((name: string) => {
          if (name === 'expected-topics') return ',,\n,  ,';
          return null;
        }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Provide at least one server context field to update.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification context-reset', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [SERVER_ABOUT_SETTING_KEY]: 'old about',
        [VERIFICATION_CONTEXT_SETTING_KEY]: 'old context',
        [EXPECTED_TOPICS_SETTING_KEY]: ['doom'],
        auto_restrict: true,
      },
    });
    const updateServerConfig = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerConfig });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('context-reset'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      settings: {
        auto_restrict: true,
      },
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: '✅ Reset AI server context to defaults.',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 3,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Enabled verification reply AI analysis'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-view', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 4,
      },
    });
    const { handler, configService } = buildHandler({ getServerConfig });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Verification reply AI analysis settings'),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Enabled: `yes`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: false,
        verification_ai_thread_analysis_message_limit: 3,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_ENABLED_SETTING_KEY]: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Disabled verification reply AI analysis'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config verification analysis-set-limit', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        verification_ai_thread_analysis_enabled: true,
        verification_ai_thread_analysis_message_limit: 5,
      },
    });
    const { handler, configService } = buildHandler({ updateServerSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('verification'),
        getSubcommand: jest.fn().mockReturnValue('analysis-set-limit'),
        getInteger: jest.fn().mockReturnValue(5),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [VERIFICATION_AI_THREAD_ANALYSIS_MESSAGE_LIMIT_SETTING_KEY]: 5,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated verification reply AI analysis message limit'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config heuristic keywords-remove when keyword is missing', async () => {
    const getHeuristicSettings = jest.fn().mockResolvedValue({
      messageThreshold: 5,
      timeWindowMs: 10_000,
      suspiciousKeywords: ['free nitro'],
    });
    const { handler, configService } = buildHandler({ getHeuristicSettings });

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
        getSubcommandGroup: jest.fn().mockReturnValue('heuristic'),
        getSubcommand: jest.fn().mockReturnValue('keywords-remove'),
        getString: jest.fn().mockReturnValue('unknown keyword'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateHeuristicSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('is not in the configured list'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects empty keyword input for /config heuristic keywords-remove', async () => {
    const { handler, configService } = buildHandler();

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
        getSubcommandGroup: jest.fn().mockReturnValue('heuristic'),
        getSubcommand: jest.fn().mockReturnValue('keywords-remove'),
        getString: jest.fn().mockReturnValue('   '),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.getHeuristicSettings).not.toHaveBeenCalled();
    expect(configService.updateHeuristicSettings).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Keyword cannot be empty.',
      flags: MessageFlags.Ephemeral,
    });
  });
});
