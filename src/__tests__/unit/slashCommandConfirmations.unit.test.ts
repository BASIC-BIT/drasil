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
