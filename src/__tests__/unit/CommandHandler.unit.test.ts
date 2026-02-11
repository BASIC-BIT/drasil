import { MessageFlags, PermissionFlagsBits, User } from 'discord.js';
import { CommandHandler } from '../../controllers/CommandHandler';

describe('CommandHandler (unit)', () => {
  type HandlerOverrides = Partial<{
    banUser: jest.Mock;
    updateServerConfig: jest.Mock;
    getHeuristicSettings: jest.Mock;
    updateHeuristicSettings: jest.Mock;
    resetHeuristicSettings: jest.Mock;
  }>;

  const buildHandler = (overrides: HandlerOverrides = {}) => {
    const userModerationService = {
      banUser: overrides.banUser ?? jest.fn().mockResolvedValue(true),
    } as any;

    const configService = {
      updateServerConfig: overrides.updateServerConfig ?? jest.fn().mockResolvedValue({}),
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

    return {
      handler: new CommandHandler(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        configService,
        userModerationService,
        {} as any
      ),
      userModerationService,
      configService,
    };
  };

  it('registers /ban with default BanMembers permission', () => {
    const { handler } = buildHandler();
    const commands = (handler as any).commands as any[];
    const banCommand = commands.find((c) => c.name === 'ban');

    expect(banCommand).toBeDefined();
    expect(banCommand.default_member_permissions).toBe(PermissionFlagsBits.BanMembers.toString());
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
});
