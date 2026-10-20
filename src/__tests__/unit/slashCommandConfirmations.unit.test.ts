import {
  handleSlashCommandConfirmationButton,
  requestSlashCommandConfirmation,
} from '../../utils/slashCommandConfirmations';

describe('slashCommandConfirmations (unit)', () => {
  it('removes pending confirmation when initial reply fails', async () => {
    const interaction = {
      user: { id: 'user-1' },
      guildId: 'guild-1',
      reply: jest.fn().mockRejectedValue(new Error('Discord API unavailable')),
    } as any;

    await expect(
      requestSlashCommandConfirmation(interaction, {
        message: 'Confirm action?',
        confirmLabel: 'Confirm',
        execute: jest.fn(),
      })
    ).rejects.toThrow('Discord API unavailable');

    const attemptedCustomId =
      interaction.reply.mock.calls[0][0].components[0].components[0].toJSON().custom_id;
    const buttonInteraction = {
      customId: attemptedCustomId,
      user: interaction.user,
      guildId: interaction.guildId,
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    } as any;

    await handleSlashCommandConfirmationButton(buttonInteraction);

    expect(buttonInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'That confirmation expired. Re-run the command if you still want to continue.',
      })
    );
  });
});

describe('slash confirmation authentication and expiry', () => {
  it.each(['actor', 'guild', 'expiry'] as const)(
    'rejects changed %s before the action callback',
    async (changed) => {
      jest.useFakeTimers();
      try {
        const execute = jest.fn();
        const interaction = {
          user: { id: 'actor-1' },
          guildId: 'guild-1',
          reply: jest.fn(),
        } as any;
        await requestSlashCommandConfirmation(interaction, {
          message: 'Ban user-1?',
          confirmLabel: 'Ban',
          execute,
        });
        const customId =
          interaction.reply.mock.calls[0][0].components[0].components[0].toJSON().custom_id;
        if (changed === 'expiry') jest.advanceTimersByTime(10 * 60 * 1000 + 1);
        await handleSlashCommandConfirmationButton({
          customId,
          user: { id: changed === 'actor' ? 'other-actor' : 'actor-1' },
          guildId: changed === 'guild' ? 'other-guild' : 'guild-1',
          reply: jest.fn(),
        } as any);
        expect(execute).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    }
  );
});

it('passes the original action-bound evidence after authenticated confirmation', async () => {
  const execute = jest.fn();
  const interaction = { user: { id: 'actor-1' }, guildId: 'guild-1', reply: jest.fn() } as any;
  const options = {
    message: 'Ban user-1?',
    confirmLabel: 'Ban',
    confirmation: { action: 'ban_user', targetId: 'user-1' },
    execute,
  };
  await requestSlashCommandConfirmation(interaction, options);
  const button = {
    customId: interaction.reply.mock.calls[0][0].components[0].components[0].toJSON().custom_id,
    user: interaction.user,
    guildId: 'guild-1',
  } as any;
  await handleSlashCommandConfirmationButton(button);
  expect(execute).toHaveBeenCalledWith(button, {
    action: 'ban_user',
    targetId: 'user-1',
    guildId: 'guild-1',
    actorId: 'actor-1',
  });
});
