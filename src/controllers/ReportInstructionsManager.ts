import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  TextChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';

const REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY = 'report_instructions_channel_id';
const REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY = 'report_instructions_message_id';

export class ReportInstructionsManager {
  public constructor(
    private readonly client: Client,
    private readonly configService: IConfigService
  ) {}

  public async upsertReportInstructionsMessage(
    guildId: string,
    targetChannel: TextChannel
  ): Promise<{ action: 'sent' | 'updated' | 'recreated'; messageId: string }> {
    const messagePayload = this.buildReportInstructionsMessagePayload();
    const serverConfig = await this.configService.getServerConfig(guildId);
    const existingChannelId = serverConfig.settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY];
    const existingMessageId = serverConfig.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    let messageId: string;
    let action: 'sent' | 'updated' | 'recreated' = 'sent';

    if (existingChannelId === targetChannel.id && existingMessageId) {
      const existingMessage = await targetChannel.messages
        .fetch(existingMessageId)
        .catch(() => null);

      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await targetChannel.send(messagePayload);
        messageId = sentMessage.id;
        action = 'recreated';
      }
    } else {
      await this.deleteStaleReportInstructionsMessage(existingChannelId, existingMessageId);
      const existingMessage = await this.findExistingReportInstructionsMessage(targetChannel);
      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await targetChannel.send(messagePayload);
        messageId = sentMessage.id;
      }
    }

    await this.configService.updateServerSettings(guildId, {
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: targetChannel.id,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: messageId,
    });

    return { action, messageId };
  }

  private async findExistingReportInstructionsMessage(
    targetChannel: TextChannel
  ): Promise<Message | null> {
    const botUserId = this.client.user?.id;
    if (!botUserId) {
      return null;
    }

    const messageManager = (targetChannel as { messages?: Pick<TextChannel['messages'], 'fetch'> })
      .messages;
    if (!messageManager || typeof messageManager.fetch !== 'function') {
      return null;
    }

    const messages = await Promise.resolve(messageManager.fetch({ limit: 50 })).catch(() => null);
    if (!messages) {
      return null;
    }

    return (
      messages.find(
        (message) =>
          message.author.id === botUserId &&
          message.embeds.some((embed) => embed.title === 'Report a User')
      ) ?? null
    );
  }

  private async deleteStaleReportInstructionsMessage(
    existingChannelId: string | null | undefined,
    existingMessageId: string | null | undefined
  ): Promise<void> {
    if (!existingChannelId || !existingMessageId) {
      return;
    }

    try {
      const existingChannel = await this.client.channels.fetch(existingChannelId).catch(() => null);
      if (!existingChannel || !('messages' in existingChannel)) {
        return;
      }

      const existingMessage = await existingChannel.messages
        .fetch(existingMessageId)
        .catch(() => null);
      await existingMessage?.delete().catch((error) => {
        console.warn('Failed to delete stale report instructions message:', error);
      });
    } catch (error) {
      console.warn('Failed to clean up stale report instructions message:', error);
    }
  }

  private buildReportInstructionsMessagePayload(): {
    embeds: EmbedBuilder[];
    components: ActionRowBuilder<ButtonBuilder>[];
  } {
    // Create the embed
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Report a User')
      .setDescription(
        'If you see a user violating server rules or engaging in suspicious activity, ' +
          'use the button below to open a private report thread and add context. ' +
          'You can also use `/report user:<user>`, right-click a user and choose ' +
          '`Apps` -> `Report User`, or right-click a message and choose ' +
          '`Apps` -> `Report Message` so Drasil can include message evidence. ' +
          'Your report will be reviewed by the moderation team.'
      )
      .setFooter({ text: 'Your reports help keep the community safe!' });

    // Create the button
    const reportButton = new ButtonBuilder()
      .setCustomId('report_user_initiate') // Unique ID for the button interaction
      .setLabel('Report a user')
      .setStyle(ButtonStyle.Primary);

    // Create an action row for the button
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);

    return { embeds: [embed], components: [row] };
  }
}
