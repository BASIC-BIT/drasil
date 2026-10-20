import {
  MessageFlags,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
} from 'discord.js';

type ConfigurationResponse = Pick<InteractionReplyOptions, 'content' | 'allowedMentions' | 'flags'>;

export async function deferConfigurationMutation(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

export async function replyToConfiguration(
  interaction: ChatInputCommandInteraction,
  response: ConfigurationResponse
): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({
      content: response.content,
      ...(response.allowedMentions === undefined
        ? {}
        : { allowedMentions: response.allowedMentions }),
    });
  } else if (interaction.replied) {
    await interaction.followUp(response);
  } else {
    await interaction.reply(response);
  }
}
