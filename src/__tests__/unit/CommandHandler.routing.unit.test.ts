import { MessageFlags } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler routing (unit)', () => {
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
});
