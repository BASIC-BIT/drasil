import {
  ApplicationCommandType,
  ApplicationIntegrationType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import {
  DISCORD_APPLICATION_COMMAND_TEXT_LIMIT,
  getApplicationCommandTextSize,
} from '../../controllers/commandDefinitions';
import { USER_REPORT_REASON_MAX_LENGTH } from '../../utils/userReportSettings';
import { buildHandler, restoreUserInstallReportingEnvAfterEach } from './commandHandlerTestHarness';

describe('CommandHandler command catalog (unit)', () => {
  restoreUserInstallReportingEnvAfterEach();

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
      'ping',
      'ban',
      'report',
      'setupverification',
      'config',
      'audit',
      'flaguser',
      'case',
      'close-report',
      'setupreportbutton',
    ]) {
      const command = commands.find((c) => c.name === name);
      expect(command).toBeDefined();
      expect(command.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
      expect(command.contexts).toEqual([InteractionContextType.Guild]);
    }
  });

  it('handles /ping', async () => {
    const { handler } = buildHandler();
    const interaction = {
      commandName: 'ping',
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Pong!',
      flags: MessageFlags.Ephemeral,
    });
  });

  it('keeps each application command under Discord text size limits', () => {
    process.env.DRASIL_USER_INSTALL_REPORTING_ENABLED = 'true';
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];

    const oversizedCommands = commands
      .map((command) => ({ name: command.name, textSize: getApplicationCommandTextSize(command) }))
      .filter((command) => command.textSize > DISCORD_APPLICATION_COMMAND_TEXT_LIMIT);

    expect(oversizedCommands).toEqual([]);
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

  it('registers /close-report without default moderation permissions', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const closeReportCommand = commands.find((c) => c.name === 'close-report');

    expect(closeReportCommand).toBeDefined();
    expect(closeReportCommand.default_member_permissions).toBeUndefined();
    expect(closeReportCommand.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(closeReportCommand.contexts).toEqual([InteractionContextType.Guild]);
  });

  it('registers case-role lockdown config commands', () => {
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
    const applySubcommand = lockdownGroup.options.find((option: any) => option.name === 'apply');
    expect(applySubcommand.options.map((option: any) => option.name)).toContain('unsync-allowed');
  });

  it('registers role quarantine config commands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');
    const quarantineGroup = configCommand.options.find(
      (option: any) => option.name === 'role-quarantine'
    );

    expect(quarantineGroup).toBeDefined();
    expect(quarantineGroup.options.map((option: any) => option.name)).toEqual(
      expect.arrayContaining(['view', 'set-mode', 'exempt-add', 'exempt-remove'])
    );
    const setModeSubcommand = quarantineGroup.options.find(
      (option: any) => option.name === 'set-mode'
    );
    const modeOption = setModeSubcommand.options.find((option: any) => option.name === 'mode');
    expect(modeOption.choices.map((choice: any) => choice.value)).toEqual(['off', 'on']);
  });

  it('registers role gate config commands', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');
    const roleGateGroup = configCommand.options.find((option: any) => option.name === 'role-gate');

    expect(roleGateGroup).toBeDefined();
    expect(roleGateGroup.options.map((option: any) => option.name)).toEqual(
      expect.arrayContaining([
        'view',
        'enable',
        'disable',
        'set-honeypot-role',
        'clear-honeypot-role',
        'set-member-access-role',
        'clear-member-access-role',
        'set-honeypot-response',
      ])
    );
    const responseSubcommand = roleGateGroup.options.find(
      (option: any) => option.name === 'set-honeypot-response'
    );
    const modeOption = responseSubcommand.options.find((option: any) => option.name === 'mode');
    expect(modeOption.choices.map((choice: any) => choice.value)).toEqual([
      'off',
      'record_only',
      'notify_only',
      'restrict',
    ]);
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
      'case-role',
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
      'integrity',
      'close-resolved-threads',
      'ignore-detection',
      'restore-detection',
    ]);
    const integritySubcommand = auditCommand.options.find(
      (option: any) => option.name === 'integrity'
    );
    expect(integritySubcommand.options.map((option: any) => option.name)).toEqual([
      'scope',
      'days',
      'limit',
      'user',
    ]);
  });

  it('registers /config setup and validate', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const configCommand = commands.find((c) => c.name === 'config');

    expect(configCommand.options.map((option: any) => option.name)).toContain('validate');
    expect(configCommand.options.map((option: any) => option.name)).toContain('setup');
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

  it('registers guild-only Open Case user context command for case moderators', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const openCaseCommand = commands.find(
      (c) => c.name === 'Open Case' && c.type === ApplicationCommandType.User
    );

    expect(openCaseCommand).toBeDefined();
    expect(openCaseCommand.type).toBe(ApplicationCommandType.User);
    expect(openCaseCommand.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(openCaseCommand.contexts).toEqual([InteractionContextType.Guild]);
    expect(openCaseCommand.default_member_permissions).toBe(
      PermissionFlagsBits.ModerateMembers.toString()
    );
  });

  it('registers guild-only Open Case message context command for case moderators', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const openCaseCommand = commands.find(
      (c) => c.name === 'Open Case' && c.type === ApplicationCommandType.Message
    );

    expect(openCaseCommand).toBeDefined();
    expect(openCaseCommand.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(openCaseCommand.contexts).toEqual([InteractionContextType.Guild]);
    expect(openCaseCommand.default_member_permissions).toBe(
      PermissionFlagsBits.ModerateMembers.toString()
    );
  });

  it.each([
    ['Ban User', ApplicationCommandType.User, PermissionFlagsBits.BanMembers],
    ['Ban User', ApplicationCommandType.Message, PermissionFlagsBits.BanMembers],
    ['Kick User', ApplicationCommandType.User, PermissionFlagsBits.KickMembers],
    ['Kick User', ApplicationCommandType.Message, PermissionFlagsBits.KickMembers],
  ])('registers guild-only %s context command', (name, type, permission) => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const command = commands.find((c) => c.name === name && c.type === type);

    expect(command).toBeDefined();
    expect(command.integration_types).toEqual([ApplicationIntegrationType.GuildInstall]);
    expect(command.contexts).toEqual([InteractionContextType.Guild]);
    expect(command.default_member_permissions).toBe(permission.toString());
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
        'kick-action-enable',
        'kick-action-disable',
        'observed-kick-enable',
        'observed-kick-disable',
        'auto-kick-enable',
        'auto-kick-disable',
        'set-auto-kick-threshold',
      ])
    );
  });

  it('registers /case admin workflows', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const caseCommand = commands.find((c) => c.name === 'case');

    expect(caseCommand).toBeDefined();
    expect(caseCommand.default_member_permissions).toBe(
      PermissionFlagsBits.ModerateMembers.toString()
    );
    expect(caseCommand.options.map((option: any) => option.name)).toEqual([
      'open',
      'repair',
      'refresh',
      'intake-role',
    ]);

    const open = caseCommand.options.find((option: any) => option.name === 'open');
    expect(open.options.map((option: any) => option.name)).toEqual(['user', 'reason']);

    const repair = caseCommand.options.find((option: any) => option.name === 'repair');
    expect(repair.options.map((option: any) => option.name)).toEqual(['user']);

    const refresh = caseCommand.options.find((option: any) => option.name === 'refresh');
    expect(refresh.options.map((option: any) => option.name)).toEqual(['user', 'case-id']);

    const intakeRole = caseCommand.options.find((option: any) => option.name === 'intake-role');
    expect(intakeRole.options.map((option: any) => option.name)).toEqual([
      'role',
      'execute',
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
        'intake-confirmed-response',
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
});
