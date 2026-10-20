import { MessageFlags } from 'discord.js';
import {
  handleSlashCommandConfirmationButton,
  requestSlashCommandConfirmation,
} from '../../utils/slashCommandConfirmations';

describe.each([false, true])('slashCommandConfirmations deferred=%s (unit)', (deferred) => {
  it('removes pending confirmation when initial reply fails', async () => {
    const interaction = {
      deferred,
      user: { id: 'user-1' },
      guildId: 'guild-1',
      reply: jest.fn().mockRejectedValue(new Error('Discord API unavailable')),
      editReply: jest.fn().mockRejectedValue(new Error('Discord API unavailable')),
    } as any;

    await expect(
      requestSlashCommandConfirmation(interaction, {
        message: 'Confirm action?',
        confirmLabel: 'Confirm',
        execute: jest.fn(),
      })
    ).rejects.toThrow('Discord API unavailable');

    const attemptedCustomId =
      interaction[
        deferred ? 'editReply' : 'reply'
      ].mock.calls[0][0].components[0].components[0].toJSON().custom_id;
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

describe.each([false, true])(
  'slash confirmation authentication and expiry deferred=%s',
  (deferred) => {
    it.each(['actor', 'guild', 'expiry'] as const)(
      'rejects changed %s before the action callback',
      async (changed) => {
        jest.useFakeTimers();
        try {
          const execute = jest.fn();
          const interaction = {
            deferred,
            user: { id: 'actor-1' },
            guildId: 'guild-1',
            reply: jest.fn(),
            editReply: jest.fn(),
          } as any;
          await requestSlashCommandConfirmation(interaction, {
            message: 'Ban user-1?',
            confirmLabel: 'Ban',
            execute,
          });
          const customId =
            interaction[
              deferred ? 'editReply' : 'reply'
            ].mock.calls[0][0].components[0].components[0].toJSON().custom_id;
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
  }
);

it.each([
  [false, 'confirm'],
  [true, 'confirm'],
  [false, 'cancel'],
  [true, 'cancel'],
] as const)(
  'consumes original action-bound confirmation once deferred=%s action=%s',
  async (deferred, action) => {
    const execute = jest.fn();
    const interaction = {
      deferred,
      user: { id: 'actor-1' },
      guildId: 'guild-1',
      reply: jest.fn(),
      editReply: jest.fn(),
    } as any;
    const options = {
      message: 'Ban user-1?',
      confirmLabel: 'Ban',
      confirmation: { action: 'ban_user', targetId: 'user-1' },
      execute,
    };
    await requestSlashCommandConfirmation(interaction, options);
    const response = interaction[deferred ? 'editReply' : 'reply'].mock.calls[0][0];
    expect(response).toMatchObject({ content: options.message, allowedMentions: { parse: [] } });
    expect(response.flags).toBe(deferred ? undefined : MessageFlags.Ephemeral);
    expect(interaction[deferred ? 'reply' : 'editReply']).not.toHaveBeenCalled();
    const [confirm, cancel] = response.components[0].components.map(
      (button: { toJSON(): { custom_id: string; label: string } }) => button.toJSON()
    );
    expect(confirm).toMatchObject({
      custom_id: expect.stringMatching(/^slash_confirm:confirm:/),
      label: 'Ban',
    });
    expect(cancel).toMatchObject({
      custom_id: confirm.custom_id.replace(':confirm:', ':cancel:'),
      label: 'Cancel',
    });
    const button = {
      customId: action === 'confirm' ? confirm.custom_id : cancel.custom_id,
      user: interaction.user,
      guildId: 'guild-1',
      reply: jest.fn(),
      update: jest.fn(),
    } as any;
    await handleSlashCommandConfirmationButton(button);
    await handleSlashCommandConfirmationButton(button);
    expect(execute).toHaveBeenCalledTimes(action === 'confirm' ? 1 : 0);
    expect(button.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'That confirmation expired. Re-run the command if you still want to continue.',
      })
    );
    if (action === 'cancel') {
      expect(button.update).toHaveBeenCalledWith({ content: 'Cancelled.', components: [] });
    } else {
      expect(execute).toHaveBeenCalledWith(button, {
        action: 'ban_user',
        targetId: 'user-1',
        guildId: 'guild-1',
        actorId: 'actor-1',
      });
    }
  }
);
