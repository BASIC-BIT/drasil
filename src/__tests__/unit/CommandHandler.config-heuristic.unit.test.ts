import { MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler heuristic config commands (unit)', () => {
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
