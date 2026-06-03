import { PermissionFlagsBits } from 'discord.js';
import { buildHandler } from './commandHandlerTestHarness';

describe('CommandHandler legacy test commands (unit)', () => {
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
});
