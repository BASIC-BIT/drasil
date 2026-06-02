import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from 'discord.js';
import { CommandHandler } from '../../controllers/CommandHandler';
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
  USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY,
  USER_REPORT_REASON_MAX_LENGTH,
  USER_REPORT_REASON_REQUIRED_SETTING_KEY,
} from '../../utils/userReportSettings';
import { MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY } from '../../utils/detectionResponseSettings';

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
    handleMessageReport: jest.Mock;
    openAdminCase: jest.Mock;
    intakeRoleMembers: jest.Mock;
    setupVerificationChannel: jest.Mock;
    setupDiagnosticsService: any | null;
    validateGuildSetup: jest.Mock;
    validateSetupCandidate: jest.Mock;
    excludeDetectionFromAccounting: jest.Mock;
    restoreDetectionAccounting: jest.Mock;
  }>;

  const originalUserInstallReportingEnabled = process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;

  afterEach(() => {
    if (originalUserInstallReportingEnabled === undefined) {
      delete process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;
    } else {
      process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = originalUserInstallReportingEnabled;
    }
  });

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
      handleMessageReport: overrides.handleMessageReport ?? jest.fn().mockResolvedValue(true),
      openAdminCase:
        overrides.openAdminCase ??
        jest.fn().mockResolvedValue({
          opened: true,
          restrictionAttempted: false,
          restricted: false,
        }),
      intakeRoleMembers:
        overrides.intakeRoleMembers ??
        jest.fn().mockResolvedValue({
          batchId: 'role-intake-1',
          roleId: 'role-1',
          roleName: 'restricted',
          action: 'open_case',
          execute: false,
          totalMembers: 2,
          eligibleMembers: 1,
          processed: 1,
          opened: 0,
          skippedBots: 1,
          skippedActiveCases: 0,
          skippedOverLimit: 0,
          failed: 0,
          failures: [],
        }),
      excludeDetectionFromAccounting:
        overrides.excludeDetectionFromAccounting ?? jest.fn().mockResolvedValue({ id: 'det-1' }),
      restoreDetectionAccounting:
        overrides.restoreDetectionAccounting ?? jest.fn().mockResolvedValue({ id: 'det-1' }),
    } as any;

    const notificationManager = {
      setupVerificationChannel:
        overrides.setupVerificationChannel ?? jest.fn().mockResolvedValue('created-channel-1'),
    } as any;
    const setupDiagnosticsService =
      overrides.setupDiagnosticsService === null
        ? undefined
        : ({
            validateGuildSetup:
              overrides.validateGuildSetup ??
              jest.fn().mockResolvedValue({
                guildId: 'guild-1',
                checkedAt: new Date('2026-01-01T00:00:00.000Z'),
                issues: [],
                errorCount: 0,
                warningCount: 0,
              }),
            validateSetupCandidate:
              overrides.validateSetupCandidate ??
              jest.fn().mockResolvedValue({
                guildId: 'guild-1',
                checkedAt: new Date('2026-01-01T00:00:00.000Z'),
                issues: [],
                errorCount: 0,
                warningCount: 0,
              }),
          } as any);
    const client = {
      user: { id: 'client-1' },
    } as any;

    return {
      handler: new CommandHandler(
        client,
        {} as any,
        {} as any,
        notificationManager,
        configService,
        userModerationService,
        securityActionService,
        undefined,
        setupDiagnosticsService
      ),
      client,
      userModerationService,
      notificationManager,
      configService,
      securityActionService,
      setupDiagnosticsService,
    };
  };

  it('registers /ban with default BanMembers permission', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const banCommand = commands.find((c) => c.name === 'ban');

    expect(banCommand).toBeDefined();
    expect(banCommand.default_member_permissions).toBe(PermissionFlagsBits.BanMembers.toString());
  });

  it('registers server-only slash commands as guild install commands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];

    for (const name of [
      'ban',
      'report',
      'setupverification',
      'config',
      'audit',
      'flaguser',
      'case',
      'setupreportbutton',
    ]) {
      const command = commands.find((c) => c.name === name);
      expect(command).toBeDefined();
      expect(command.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
      expect(command.contexts).toEqual([InteractionContextType.Guild]);
    }
  });

  it('registers /report without default moderation permissions', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const reportCommand = commands.find((c) => c.name === 'report');

    expect(reportCommand).toBeDefined();
    expect(reportCommand.default_member_permissions).toBeUndefined();
    expect(reportCommand.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(reportCommand.contexts).toEqual([InteractionContextType.Guild]);
    expect(reportCommand.options.map((option: any) => option.name)).toEqual(['user', 'reason']);
    expect(reportCommand.options.find((option: any) => option.name === 'reason').max_length).toBe(
      USER_REPORT_REASON_MAX_LENGTH
    );
  });

  it('registers restricted-role lockdown config commands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');
    const lockdownGroup = configCommand.options.find((option: any) => option.name === 'lockdown');

    expect(lockdownGroup).toBeDefined();
    expect(lockdownGroup.options.map((option: any) => option.name)).toEqual(
      expect.arrayContaining(['view', 'audit', 'apply', 'disable', 'allow-add', 'allow-remove'])
    );
    for (const subcommandName of ['allow-add', 'allow-remove']) {
      const subcommand = lockdownGroup.options.find(
        (option: any) => option.name === subcommandName
      );
      const channelOption = subcommand.options.find((option: any) => option.name === 'channel');
      expect(channelOption.channel_types).toContain(ChannelType.GuildMedia);
    }
  });

  it('denies legacy test commands for non-admin members', async () => {
    const { handler } = buildHandler();
    const message = {
      content: '!test spam',
      member: {
        permissions: {
          has: jest.fn().mockReturnValue(false),
        },
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleTestCommands(message);

    expect(message.member.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.Administrator);
    expect(message.reply).toHaveBeenCalledWith(
      'You need administrator permissions to use test commands.'
    );
  });

  it('registers /setupverification with typed role and channel options', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const setupCommand = commands.find((c) => c.name === 'setupverification');

    expect(setupCommand).toBeDefined();
    expect(setupCommand.default_member_permissions).toBe(
      PermissionFlagsBits.Administrator.toString()
    );
    expect(setupCommand.options.map((option: any) => option.name)).toEqual([
      'restricted-role',
      'admin-channel',
      'verification-channel',
    ]);
  });

  it('registers /audit detection accounting subcommands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const auditCommand = commands.find((c) => c.name === 'audit');

    expect(auditCommand).toBeDefined();
    expect(auditCommand.default_member_permissions).toBe(
      PermissionFlagsBits.ManageGuild.toString()
    );
    expect(auditCommand.options.map((option: any) => option.name)).toEqual([
      'ignore-detection',
      'restore-detection',
    ]);
  });

  it('registers /config setup and validate', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    expect(configCommand.options.map((option: any) => option.name)).toContain('validate');
    expect(configCommand.options.map((option: any) => option.name)).toContain('setup');
  });

  it('explains when a guild-only slash command is used before Drasil is installed', async () => {
    const { handler } = buildHandler();
    const interaction = {
      commandName: 'report',
      guild: null,
      guildId: 'guild-1',
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Drasil is not installed in this server yet.'),
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.reply.mock.calls[0][0].content).toContain(
      'https://discord.com/oauth2/authorize?'
    );
  });

  it('handles /audit ignore-detection for users with Manage Server permission', async () => {
    const excludeDetectionFromAccounting = jest.fn().mockResolvedValue({ id: 'det-1' });
    const { handler, securityActionService } = buildHandler({ excludeDetectionFromAccounting });

    const interaction = {
      commandName: 'audit',
      guild: { id: 'guild-1' },
      channelId: 'channel-1',
      user: { id: 'admin-1' },
      memberPermissions: {
        has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageGuild),
      },
      options: {
        getSubcommand: jest.fn().mockReturnValue('ignore-detection'),
        getString: jest.fn((name: string) =>
          name === 'detection-id' ? 'det-1' : 'testing false positive'
        ),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.excludeDetectionFromAccounting).toHaveBeenCalledWith(
      'guild-1',
      'det-1',
      interaction.user,
      'testing false positive'
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Detection det-1 is now ignored for future accounting.',
    });
  });

  it('registers guild-only Report User context command', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const reportUserCommand = commands.find((c) => c.name === 'Report User');

    expect(reportUserCommand).toBeDefined();
    expect(reportUserCommand.type).toBe(ApplicationCommandType.User);
    expect(reportUserCommand.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(reportUserCommand.contexts).toEqual([InteractionContextType.Guild]);
  });

  it('does not register Report Message context command unless user-install reporting is enabled', () => {
    delete process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;

    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];

    expect(commands.find((c) => c.name === 'Report Message')).toBeUndefined();
  });

  it('registers user-installable Report Message context command when enabled', () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';

    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const reportMessageCommand = commands.find((c) => c.name === 'Report Message');

    expect(reportMessageCommand).toBeDefined();
    expect(reportMessageCommand.type).toBe(ApplicationCommandType.Message);
    expect(reportMessageCommand.integration_types).toEqual([
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    ]);
    expect(reportMessageCommand.contexts).toEqual([
      InteractionContextType.Guild,
      InteractionContextType.BotDM,
      InteractionContextType.PrivateChannel,
    ]);
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
        'set-event-mode',
        'clear-event-mode',
        'set-notification-channel',
        'clear-notification-channel',
        'set-notification-threshold',
        'set-notification-window',
        'moderator-exemption-enable',
        'moderator-exemption-disable',
        'ban-action-enable',
        'ban-action-disable',
      ])
    );
  });

  it('registers /case admin workflows', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const caseCommand = commands.find((c) => c.name === 'case');

    expect(caseCommand).toBeDefined();
    expect(caseCommand.default_member_permissions).toBe(
      PermissionFlagsBits.Administrator.toString()
    );
    expect(caseCommand.options.map((option: any) => option.name)).toEqual([
      'open',
      'restrict',
      'intake-role',
    ]);

    const intakeRole = caseCommand.options.find((option: any) => option.name === 'intake-role');
    expect(intakeRole.options.map((option: any) => option.name)).toEqual([
      'role',
      'execute',
      'action',
      'limit',
      'reason',
    ]);
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
      expect.arrayContaining([
        'view',
        'reason-require',
        'reason-optional',
        'external-reports',
        'ai-set-max-images',
        'ai-set-max-image-mb',
      ])
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
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true },
    });
    const { handler, userModerationService } = buildHandler({ banUser, getServerConfig });

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
      id: 'guild-1',
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
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
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: { [MODERATOR_BAN_ACTION_ENABLED_SETTING_KEY]: true },
    });
    const { handler, userModerationService } = buildHandler({ banUser, getServerConfig });

    const invoker: User = { id: 'user-1' } as User;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;

    const guild = {
      id: 'guild-1',
      members: {
        me: { permissions: { has: jest.fn().mockReturnValue(true) } },
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

  it('opens an admin review case without restricting via /case open', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: false,
      restricted: false,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockImplementation(async (id: string) => {
          if (id === targetUser.id) return targetMember;
          return null;
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      memberPermissions: { has: jest.fn().mockReturnValue(true) },
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('manual review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.members.fetch).toHaveBeenCalledWith(targetUser.id);
    expect(guild.members.fetch).not.toHaveBeenCalledWith(invoker.id);
    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(targetMember, invoker, {
      action: 'open_case',
      reason: 'manual review',
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Opened a review case for target#0001.',
      allowedMentions: { parse: [] },
    });
  });

  it('opens and restricts an admin case via /case restrict', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: true,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockImplementation(async (id: string) =>
            id === invoker.id
              ? { permissions: { has: jest.fn().mockReturnValue(true) } }
              : targetMember
          ),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('restrict'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('restricted review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.openAdminCase).toHaveBeenCalledWith(targetMember, invoker, {
      action: 'restrict',
      reason: 'restricted review',
    });
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Opened a case for target#0001 and restricted them pending review.',
      allowedMentions: { parse: [] },
    });
  });

  it('surfaces partial restriction failure via /case restrict', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: false,
    });
    const { handler } = buildHandler({ openAdminCase });
    const invoker = { id: 'admin-1' } as any;
    const targetUser = { id: 'user-2', tag: 'target#0001' } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest
          .fn()
          .mockImplementation(async (id: string) =>
            id === invoker.id
              ? { permissions: { has: jest.fn().mockReturnValue(true) } }
              : targetMember
          ),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('restrict'),
        getUser: jest.fn().mockReturnValue(targetUser),
        getString: jest.fn().mockReturnValue('restricted review'),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Opened a case for target#0001, but I could not apply the restricted role. Check bot permissions and role hierarchy.',
      allowedMentions: { parse: [] },
    });
  });

  it('dry-runs restricted role intake via /case intake-role', async () => {
    const intakeRoleMembers = jest.fn().mockResolvedValue({
      batchId: 'role-intake-1',
      roleId: 'role-1',
      roleName: 'restricted',
      action: 'open_case',
      execute: false,
      totalMembers: 3,
      eligibleMembers: 2,
      processed: 2,
      opened: 0,
      skippedBots: 1,
      skippedActiveCases: 0,
      skippedOverLimit: 0,
      failed: 0,
      failures: [],
    });
    const { handler, securityActionService } = buildHandler({ intakeRoleMembers });
    const invoker = { id: 'admin-1' } as any;
    const role = { id: 'role-1', name: 'restricted' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('intake-role'),
        getRole: jest.fn().mockReturnValue(role),
        getBoolean: jest.fn().mockReturnValue(false),
        getInteger: jest.fn().mockReturnValue(2),
        getString: jest.fn((name: string) =>
          name === 'action' ? 'open_case' : 'restricted role cleanup'
        ),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(securityActionService.intakeRoleMembers).toHaveBeenCalledWith({
      role,
      moderator: invoker,
      reason: 'restricted role cleanup',
      action: 'open_case',
      execute: false,
      limit: 2,
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Role intake dry run');
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Re-run with `execute: true` to open cases.'
    );
  });

  it('falls back to opening cases for invalid role intake actions', async () => {
    const intakeRoleMembers = jest.fn().mockResolvedValue({
      batchId: 'role-intake-1',
      roleId: 'role-1',
      roleName: 'restricted',
      action: 'open_case',
      execute: false,
      totalMembers: 1,
      eligibleMembers: 1,
      processed: 1,
      opened: 0,
      skippedBots: 0,
      skippedActiveCases: 0,
      skippedOverLimit: 0,
      failed: 0,
      failures: [],
    });
    const { handler, securityActionService } = buildHandler({ intakeRoleMembers });
    const invoker = { id: 'admin-1' } as any;
    const role = { id: 'role-1', name: 'restricted' } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(true) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: invoker,
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('intake-role'),
        getRole: jest.fn().mockReturnValue(role),
        getBoolean: jest.fn().mockReturnValue(false),
        getInteger: jest.fn().mockReturnValue(undefined),
        getString: jest.fn((name: string) => (name === 'action' ? 'ban_everyone' : undefined)),
      },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.intakeRoleMembers).toHaveBeenCalledWith({
      role,
      moderator: invoker,
      reason: undefined,
      action: 'open_case',
      execute: false,
      limit: undefined,
    });
  });

  it('denies /case commands for non-admin members', async () => {
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: false,
      restricted: false,
    });
    const { handler, securityActionService } = buildHandler({ openAdminCase });
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue({
          permissions: { has: jest.fn().mockReturnValue(false) },
        }),
      },
    } as any;
    const interaction = {
      commandName: 'case',
      user: { id: 'user-1' },
      guild,
      options: {
        getSubcommand: jest.fn().mockReturnValue('open'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(securityActionService.openAdminCase).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'You need administrator permissions to use this command.',
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

  it('handles Report User context command in a guild', async () => {
    const handleUserReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleUserReport });

    const targetUser = {
      id: 'user-2',
      username: 'target',
      globalName: 'Target User',
    } as any;
    const targetMember = { id: targetUser.id } as any;
    const guild = {
      id: 'guild-1',
      members: {
        fetch: jest.fn().mockResolvedValue(targetMember),
      },
    } as any;

    const interaction = {
      commandName: 'Report User',
      user: { id: 'reporter-1' },
      targetUser,
      guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleUserContextMenuCommand(interaction);

    expect(securityActionService.handleUserReport).toHaveBeenCalledWith(
      targetMember,
      interaction.user
    );
    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Thank you for your report regarding <@user-2>. It has been submitted for review.',
      allowedMentions: { parse: [] },
    });
  });

  it('rejects Report User context command when a report reason is required', async () => {
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
      commandName: 'Report User',
      user: { id: 'reporter-1' },
      targetUser: { id: 'user-2', username: 'target' },
      guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleUserContextMenuCommand(interaction);

    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(securityActionService.handleUserReport).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'This server requires a report reason. Please use `/report` instead.',
    });
  });

  it('opens a Report Message modal when user-install reporting is enabled', async () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleMessageReport });

    const targetUser = { id: 'user-2', username: 'target' } as any;
    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: targetUser,
        content: 'suspicious DM',
      },
      channelId: 'channel-1',
      guildId: null,
      context: InteractionContextType.PrivateChannel,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalJson = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('rmm:message-1:channel-1:user-2:0:2');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: 'report_message_reason',
      required: false,
    });
  });

  it('requires the modal reason for guild Report Message when report reasons are required', async () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_REASON_REQUIRED_SETTING_KEY]: true,
      },
    });
    const { handler, securityActionService } = buildHandler({
      getServerConfig,
      handleMessageReport,
    });

    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: { id: 'user-2', username: 'target' },
        content: 'suspicious server message',
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      context: InteractionContextType.Guild,
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      showModal: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(getServerConfig).toHaveBeenCalledWith('guild-1');
    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.showModal).toHaveBeenCalledTimes(1);

    const modalJson = (interaction.showModal as jest.Mock).mock.calls[0][0].toJSON();
    expect(modalJson.custom_id).toBe('rmm:message-1:channel-1:user-2:guild-1:0');
    expect(modalJson.components[0].components[0]).toMatchObject({
      custom_id: 'report_message_reason',
      required: true,
    });
  });

  it('rejects Report Message context command when user-install reporting is disabled', async () => {
    delete process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED;
    const handleMessageReport = jest.fn().mockResolvedValue(true);
    const { handler, securityActionService } = buildHandler({ handleMessageReport });

    const interaction = {
      commandName: 'Report Message',
      user: { id: 'reporter-1' },
      targetMessage: {
        id: 'message-1',
        author: { id: 'user-2', username: 'target' },
        content: 'suspicious DM',
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleMessageContextMenuCommand(interaction);

    expect(securityActionService.handleMessageReport).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'User-installable message reporting is not enabled for this Drasil deployment.',
      flags: MessageFlags.Ephemeral,
    });
  });

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
      restricted_role_id: 'role-1',
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
        'Setup complete.\nRestricted role: <@&role-1>\nAdmin channel: <#channel-1>\nVerification channel: <#channel-2>',
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
      restricted_role_id: 'role-1',
      admin_channel_id: 'channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Setup complete.\nRestricted role: <@&role-1>\nAdmin channel: <#channel-1>\nCreated verification channel: <#created-channel-1>',
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
      restrictedRoleId: 'role-1',
      willCreateRestrictedRole: false,
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
      restricted_role_id: 'role-1',
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
        'Setup complete.\nRestricted role: <@&role-1>\nAdmin channel: <#channel-1>\nVerification channel: <#channel-2>',
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
          code: 'restricted-role-hierarchy',
          message: "Drasil's highest role must be above restricted role <@&role-1>.",
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

  it('handles /config setup with an existing restricted role and channels', async () => {
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      restrictedRoleId: 'role-1',
      willCreateRestrictedRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: 'verification-channel-1',
      willCreateVerificationChannel: false,
      reportInstructionsChannelId: null,
    });
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(notificationManager.setupVerificationChannel).not.toHaveBeenCalled();
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      restricted_role_id: 'role-1',
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      restrictedRoleId: 'role-1',
      willCreateRestrictedRole: false,
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

  it('handles /config setup by creating the default restricted role and verification channel', async () => {
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
      name: 'Drasil Restricted',
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
      restricted_role_id: 'created-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Created restricted role: <@&created-role-1>'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Created verification channel: <#created-channel-1>'
    );
  });

  it('reuses an existing default restricted role when no role is configured', async () => {
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
      restricted_role_id: 'missing-role-1',
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
    const defaultRole = { id: 'default-role-1', name: 'Drasil Restricted' } as any;
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
      restrictedRoleId: 'default-role-1',
      willCreateRestrictedRole: false,
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
      restricted_role_id: 'default-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Restricted role: <@&default-role-1>'),
      allowedMentions: { parse: [] },
    });
    expect(interaction.editReply.mock.calls[0][0].content).not.toContain('Created restricted role');
  });

  it('honors restricted-role-name over a differently named configured role', async () => {
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
      restricted_role_id: 'old-role-1',
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
    const configuredRole = { id: 'old-role-1', name: 'Old Restricted' } as any;
    const namedRole = { id: 'named-role-1', name: 'New Restricted' } as any;
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
        getString: jest.fn((name: string) =>
          name === 'restricted-role-name' ? 'New Restricted' : null
        ),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(guild.roles.fetch).toHaveBeenCalledWith('old-role-1');
    expect(guild.roles.create).not.toHaveBeenCalled();
    expect(setupDiagnosticsService.validateSetupCandidate).toHaveBeenCalledWith(guild, {
      restrictedRoleId: 'named-role-1',
      willCreateRestrictedRole: false,
      adminChannelId: 'admin-channel-1',
      verificationChannelId: null,
      willCreateVerificationChannel: true,
      reportInstructionsChannelId: null,
    });
    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      restricted_role_id: 'named-role-1',
      admin_channel_id: 'admin-channel-1',
      verification_channel_id: 'created-channel-1',
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain(
      'Restricted role: <@&named-role-1>'
    );
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
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

  it('rolls back a created restricted role when verification channel setup fails', async () => {
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
      content: expect.stringContaining('newly created restricted role was removed'),
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
      restricted_role_id: 'created-role-1',
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
      'newly created restricted role was removed'
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
      'The newly created restricted role was removed.'
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
        getString: jest.fn().mockReturnValue(null),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerConfig).toHaveBeenCalledWith('guild-1', {
      restricted_role_id: 'role-1',
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
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
    const restrictedRole = { id: 'role-1' } as any;
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
        getRole: jest.fn().mockReturnValue(restrictedRole),
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

  it('updates the existing report instructions message instead of sending a duplicate', async () => {
    const existingMessage = {
      id: 'message-1',
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockResolvedValue(existingMessage),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'channel-1',
        report_instructions_message_id: 'message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

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
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(targetChannel.messages.fetch).toHaveBeenCalledWith('message-1');
    expect(existingMessage.edit).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    const messagePayload = (existingMessage.edit as jest.Mock).mock.calls[0][0] as any;
    const embedJson = messagePayload.embeds[0].toJSON();
    expect(embedJson.title).toBe('Report a User');
    expect(embedJson.description).toContain('open a private report thread');
    expect(embedJson.description).not.toContain('picker');
    const buttonJson = messagePayload.components[0].toJSON().components[0];
    expect(buttonJson).toMatchObject({
      custom_id: 'report_user_initiate',
      label: 'Report a user',
    });
    expect(targetChannel.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions updated successfully in <#channel-1>.',
    });
  });

  it('recreates report instructions when the stored message no longer exists', async () => {
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockRejectedValue(new Error('missing')),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'channel-1',
        report_instructions_message_id: 'message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

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
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(targetChannel.send).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-2',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions recreated successfully in <#channel-1>.',
    });
  });

  it('reuses an existing bot-authored report instructions message without stored metadata', async () => {
    const existingMessage = {
      id: 'message-1',
      author: { id: 'client-1' },
      embeds: [{ title: 'Report a User' }],
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const targetChannel = {
      id: 'channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn().mockResolvedValue([existingMessage]),
      },
      send: jest.fn().mockResolvedValue({ id: 'message-2' }),
      toString: () => '<#channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({ settings: {} });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService } = buildHandler({ getServerConfig, updateServerSettings });

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
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(targetChannel.messages.fetch).toHaveBeenCalledWith({ limit: 50 });
    expect(existingMessage.edit).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(targetChannel.send).not.toHaveBeenCalled();
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'channel-1',
      report_instructions_message_id: 'message-1',
    });
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'Report instructions updated successfully in <#channel-1>.',
    });
  });

  it('deletes old report instructions when moving them to a new channel', async () => {
    const oldMessage = {
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const oldChannel = {
      messages: {
        fetch: jest.fn().mockResolvedValue(oldMessage),
      },
    };
    const targetChannel = {
      id: 'new-channel-1',
      type: ChannelType.GuildText,
      messages: {
        fetch: jest.fn(),
      },
      send: jest.fn().mockResolvedValue({ id: 'new-message-1' }),
      toString: () => '<#new-channel-1>',
    } as any;
    const getServerConfig = jest.fn().mockResolvedValue({
      settings: {
        report_instructions_channel_id: 'old-channel-1',
        report_instructions_message_id: 'old-message-1',
      },
    });
    const updateServerSettings = jest.fn().mockResolvedValue({});
    const { handler, configService, client } = buildHandler({
      getServerConfig,
      updateServerSettings,
    });
    client.channels = {
      fetch: jest.fn().mockResolvedValue(oldChannel),
    };

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
      commandName: 'setupreportbutton',
      user: { id: 'admin-1' },
      guild,
      options: {
        getChannel: jest.fn().mockReturnValue(targetChannel),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(client.channels.fetch).toHaveBeenCalledWith('old-channel-1');
    expect(oldChannel.messages.fetch).toHaveBeenCalledWith('old-message-1');
    expect(oldMessage.delete).toHaveBeenCalledTimes(1);
    expect(targetChannel.send).toHaveBeenCalledWith({
      embeds: expect.any(Array),
      components: expect.any(Array),
    });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_instructions_channel_id: 'new-channel-1',
      report_instructions_message_id: 'new-message-1',
    });
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

  it('handles /config validate', async () => {
    const validateGuildSetup = jest.fn().mockResolvedValue({
      guildId: 'guild-1',
      checkedAt: new Date('2026-01-01T00:00:00.000Z'),
      issues: [
        {
          severity: 'error',
          code: 'restricted-role-missing',
          message: 'Restricted role is not configured.',
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
      content: expect.stringContaining('[ERROR] Restricted role is not configured.'),
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

  it('defers /config lockdown view before loading settings', async () => {
    const getServerConfig = jest.fn().mockResolvedValue({
      verification_channel_id: 'verification-channel-1',
      settings: {
        restricted_lockdown_enabled: true,
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
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('view'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.getServerConfig).toHaveBeenCalledWith('guild-1');
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.getServerConfig.mock.invocationCallOrder[0]
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Restricted lockdown: `enabled`'),
      allowedMentions: { parse: [] },
    });
  });

  it('defers /config lockdown disable before saving settings', async () => {
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
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_enabled: false,
    });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.updateServerSettings.mock.invocationCallOrder[0]
    );
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith({
      content:
        'Restricted-role lockdown marked disabled. Existing Discord channel overwrites were not removed.',
    });
  });

  it('defers /config lockdown allow-list updates before saving settings', async () => {
    const { handler, configService } = buildHandler({
      getServerConfig: jest.fn().mockResolvedValue({
        verification_channel_id: 'verification-channel-1',
        settings: {},
      }),
    });
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
        getSubcommandGroup: jest.fn().mockReturnValue('lockdown'),
        getSubcommand: jest.fn().mockReturnValue('allow-add'),
        getChannel: jest
          .fn()
          .mockReturnValue({ id: 'media-channel-1', type: ChannelType.GuildMedia }),
      },
      reply: jest.fn().mockResolvedValue(undefined),
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      restricted_lockdown_allowed_channel_ids: ['media-channel-1'],
      restricted_lockdown_allowed_category_ids: [],
    });
    expect((interaction.deferReply as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      configService.updateServerSettings.mock.invocationCallOrder[0]
    );
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Channel <#media-channel-1> added to'),
      allowedMentions: { parse: [] },
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

  it('handles /config detection set-event-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        message_detection_response_mode: 'open_case',
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
        getSubcommand: jest.fn().mockReturnValue('set-event-mode'),
        getString: jest.fn((name: string) => (name === 'event' ? 'message' : 'open_case')),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      message_detection_response_mode: 'open_case',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Updated message detection response policy'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection clear-event-mode', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        join_detection_response_mode: null,
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
        getSubcommand: jest.fn().mockReturnValue('clear-event-mode'),
        getString: jest.fn().mockReturnValue('join'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      join_detection_response_mode: null,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Reset join detection response policy to default'),
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

  it('handles /config detection ban-action-disable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        moderator_ban_action_enabled: false,
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
        getSubcommand: jest.fn().mockReturnValue('ban-action-disable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      moderator_ban_action_enabled: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator ban action enabled: `no`'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  it('handles /config detection ban-action-enable', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        detection_response_mode: 'notify_only',
        moderator_ban_action_enabled: true,
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
        getSubcommand: jest.fn().mockReturnValue('ban-action-enable'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      moderator_ban_action_enabled: true,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Moderator ban action enabled: `yes`'),
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

  it('handles /config report external-reports', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
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
        getSubcommand: jest.fn().mockReturnValue('external-reports'),
        getString: jest.fn().mockReturnValue('notify_only'),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      [USER_REPORT_EXTERNAL_RESPONSE_MODE_SETTING_KEY]: 'notify_only',
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('External reports: `notify_only`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report ai-set-max-images', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        report_ai_max_images: 6,
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
        getSubcommand: jest.fn().mockReturnValue('ai-set-max-images'),
        getInteger: jest.fn().mockReturnValue(6),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_ai_max_images: 6,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Max images: `6`'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('handles /config report ai-set-max-image-mb', async () => {
    const updateServerSettings = jest.fn().mockResolvedValue({
      settings: {
        report_ai_max_image_bytes: 15 * 1024 * 1024,
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
        getSubcommand: jest.fn().mockReturnValue('ai-set-max-image-mb'),
        getInteger: jest.fn().mockReturnValue(15),
      },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(configService.updateServerSettings).toHaveBeenCalledWith('guild-1', {
      report_ai_max_image_bytes: 15 * 1024 * 1024,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: expect.stringContaining('Max image size: `15 MB`'),
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

  it('does not rethrow if an analytics command reply failure also prevents the error reply', async () => {
    const { handler } = buildHandler();
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
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
      replied: false,
      deferred: false,
      options: {
        getSubcommandGroup: jest.fn().mockReturnValue('analytics'),
        getSubcommand: jest.fn().mockReturnValue('view'),
      },
      reply: jest.fn().mockRejectedValue(new Error('reply failed')),
      followUp: jest.fn().mockResolvedValue(undefined),
    } as any;

    try {
      await expect(handler.handleSlashCommand(interaction)).resolves.toBeUndefined();

      expect(interaction.reply).toHaveBeenCalledTimes(2);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Failed to send analytics settings error response:',
        expect.any(Error)
      );
    } finally {
      consoleWarnSpy.mockRestore();
    }
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
