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

  it('closes the current report intake thread with /close-report', async () => {
    const reportIntakeService = {
      closeIntakeForThread: jest.fn().mockResolvedValue({
        closed: true,
        message: 'Report intake closed. No report has been filed.',
      }),
    };
    const thread = {
      id: 'thread-1',
      archived: false,
      isThread: jest.fn().mockReturnValue(true),
      setArchived: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      user: { id: 'client-1' },
      guilds: {
        fetch: jest.fn().mockResolvedValue({
          id: 'guild-1',
          members: {
            fetch: jest.fn().mockResolvedValue({
              permissions: { has: jest.fn().mockReturnValue(false) },
            }),
          },
        }),
      },
    };
    const { handler } = buildHandler({ client, reportIntakeService });
    const interaction = {
      commandName: 'close-report',
      guildId: 'guild-1',
      channel: thread,
      user: { id: 'reporter-1' },
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handler.handleSlashCommand(interaction);

    expect(reportIntakeService.closeIntakeForThread).toHaveBeenCalledWith({
      threadId: 'thread-1',
      closedById: 'reporter-1',
      closedByStaff: false,
    });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Report intake closed. No report has been filed.',
      allowedMentions: { parse: [] },
    });
    expect(thread.setArchived).toHaveBeenCalledWith(true, 'Report intake closed');
  });
});
