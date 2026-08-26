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
import type { ServerSettings } from '../repositories/types';

const REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY = 'report_instructions_channel_id';
const REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY = 'report_instructions_message_id';
const REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY = 'report_instructions_cleanup_channel_id';
const REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY = 'report_instructions_cleanup_message_id';
const DISCORD_UNKNOWN_CHANNEL_ERROR_CODE = 10003;
const DISCORD_UNKNOWN_MESSAGE_ERROR_CODE = 10008;
const REPORT_INSTRUCTIONS_CLEANUP_PENDING_ERROR =
  'Report instructions were disabled, but the previous message could not be removed. Retry setup to finish cleanup.';
const REPORT_INSTRUCTIONS_ROLLBACK_PENDING_ERROR =
  'Report instructions were published but could not be tracked or removed. Retry setup to recover the message.';
const reportInstructionsExecutionChains = new Map<string, Promise<unknown>>();

export class ReportInstructionsRollbackRequiredError extends Error {
  public constructor() {
    super(REPORT_INSTRUCTIONS_ROLLBACK_PENDING_ERROR);
    this.name = 'ReportInstructionsRollbackRequiredError';
  }
}

async function runSerializedReportInstructions<T>(
  guildId: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = reportInstructionsExecutionChains.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  reportInstructionsExecutionChains.set(guildId, next);

  try {
    return await next;
  } finally {
    if (reportInstructionsExecutionChains.get(guildId) === next) {
      reportInstructionsExecutionChains.delete(guildId);
    }
  }
}

export class ReportInstructionsManager {
  public constructor(
    private readonly client: Client,
    private readonly configService: IConfigService
  ) {}

  public async upsertReportInstructionsMessage(
    guildId: string,
    targetChannel: TextChannel
  ): Promise<{ action: 'sent' | 'updated' | 'recreated'; messageId: string }> {
    return runSerializedReportInstructions(guildId, () =>
      this.upsertReportInstructionsMessageExclusive(guildId, targetChannel)
    );
  }

  private async upsertReportInstructionsMessageExclusive(
    guildId: string,
    targetChannel: TextChannel
  ): Promise<{ action: 'sent' | 'updated' | 'recreated'; messageId: string }> {
    const messagePayload = this.buildReportInstructionsMessagePayload();
    const serverConfig = await this.configService.getServerConfig(guildId);
    await this.retryPendingReportInstructionsCleanup(guildId, serverConfig.settings);
    const existingChannelId = serverConfig.settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY];
    const existingMessageId = serverConfig.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    let messageId: string;
    let createdMessage: Message | null = null;
    let action: 'sent' | 'updated' | 'recreated' = 'sent';
    const movedChannels = existingChannelId !== targetChannel.id;

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
        createdMessage = sentMessage;
        messageId = sentMessage.id;
        action = 'recreated';
      }
    } else {
      const existingMessage = await this.findExistingReportInstructionsMessage(targetChannel);
      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await targetChannel.send(messagePayload);
        createdMessage = sentMessage;
        messageId = sentMessage.id;
      }
    }

    const settingsPatch: Partial<ServerSettings> = {
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: targetChannel.id,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: messageId,
    };
    if (movedChannels && existingChannelId && existingMessageId) {
      settingsPatch[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] = existingChannelId;
      settingsPatch[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY] = existingMessageId;
    }
    try {
      await this.configService.updateServerSettings(guildId, settingsPatch);
    } catch (error) {
      if (
        createdMessage &&
        !(await this.deleteUntrackedReportInstructionsMessage(createdMessage))
      ) {
        throw new ReportInstructionsRollbackRequiredError();
      }
      throw error;
    }

    if (movedChannels && existingChannelId && existingMessageId) {
      await this.finishReportInstructionsCleanup(guildId, existingChannelId, existingMessageId);
    }

    return { action, messageId };
  }

  public async clearReportInstructions(
    guildId: string
  ): Promise<{ action: 'cleared' | 'unchanged' }> {
    return runSerializedReportInstructions(guildId, () =>
      this.clearReportInstructionsExclusive(guildId)
    );
  }

  private async clearReportInstructionsExclusive(
    guildId: string
  ): Promise<{ action: 'cleared' | 'unchanged' }> {
    const serverConfig = await this.configService.getServerConfig(guildId);
    const hadPendingCleanup = Boolean(
      serverConfig.settings[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] ||
      serverConfig.settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]
    );
    await this.retryPendingReportInstructionsCleanup(guildId, serverConfig.settings);
    const existingChannelId = serverConfig.settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY];
    const existingMessageId = serverConfig.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    const hasCleanupTarget = Boolean(existingChannelId && existingMessageId);

    await this.configService.updateServerSettings(guildId, {
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: null,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: null,
      [REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY]: hasCleanupTarget
        ? existingChannelId
        : null,
      [REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]: hasCleanupTarget
        ? existingMessageId
        : null,
    });
    if (existingChannelId && existingMessageId) {
      await this.finishReportInstructionsCleanup(guildId, existingChannelId, existingMessageId);
    }

    return {
      action: existingChannelId || existingMessageId || hadPendingCleanup ? 'cleared' : 'unchanged',
    };
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

  private async retryPendingReportInstructionsCleanup(
    guildId: string,
    settings: ServerSettings
  ): Promise<void> {
    const channelId = settings[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY];
    const messageId = settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY];
    if (!channelId && !messageId) {
      return;
    }
    if (!channelId || !messageId) {
      await this.clearPendingReportInstructionsCleanup(guildId);
      return;
    }
    await this.finishReportInstructionsCleanup(guildId, channelId, messageId);
  }

  private async finishReportInstructionsCleanup(
    guildId: string,
    channelId: string,
    messageId: string
  ): Promise<void> {
    if (!(await this.deleteReportInstructionsMessage(channelId, messageId))) {
      throw new Error(REPORT_INSTRUCTIONS_CLEANUP_PENDING_ERROR);
    }
    await this.clearPendingReportInstructionsCleanup(guildId);
  }

  private async clearPendingReportInstructionsCleanup(guildId: string): Promise<void> {
    await this.configService.updateServerSettings(guildId, {
      [REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY]: null,
      [REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]: null,
    });
  }

  private async deleteReportInstructionsMessage(
    channelId: string,
    messageId: string
  ): Promise<boolean> {
    let existingChannel;
    try {
      existingChannel = await this.client.channels.fetch(channelId);
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_CHANNEL_ERROR_CODE)) {
        return true;
      }
      console.warn('Failed to fetch stale report instructions channel:', error);
      return false;
    }
    if (!existingChannel || !('messages' in existingChannel)) {
      return true;
    }

    let existingMessage;
    try {
      existingMessage = await existingChannel.messages.fetch(messageId);
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return true;
      }
      console.warn('Failed to fetch stale report instructions message:', error);
      return false;
    }
    try {
      await existingMessage.delete();
      return true;
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return true;
      }
      console.warn('Failed to delete stale report instructions message:', error);
      return false;
    }
  }

  private async deleteUntrackedReportInstructionsMessage(message: Message): Promise<boolean> {
    try {
      await message.delete();
      return true;
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return true;
      }
      console.warn('Failed to remove untracked report instructions message:', error);
      return false;
    }
  }

  private isUnknownDiscordResource(error: unknown, code: number): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
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
