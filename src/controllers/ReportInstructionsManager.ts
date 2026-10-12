import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Message,
  PermissionFlagsBits,
  TextChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import type { ServerSettings } from '../repositories/types';
import { randomBytes } from 'node:crypto';

const REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY = 'report_instructions_channel_id';
const REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY = 'report_instructions_message_id';
const REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY = 'report_instructions_message_channel_id';
const REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY = 'report_instructions_cleanup_channel_id';
const REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY = 'report_instructions_cleanup_message_id';
const REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY =
  'report_instructions_pending_publication';
const REPORT_PANEL_RECOVERY_PAGE_LIMIT = 10;
const REPORT_PANEL_RECOVERY_PAGE_SIZE = 100;
const DISCORD_UNKNOWN_CHANNEL_ERROR_CODE = 10003;
const DISCORD_UNKNOWN_MESSAGE_ERROR_CODE = 10008;
const DISCORD_MISSING_ACCESS_ERROR_CODE = 50001;
const DISCORD_MISSING_PERMISSIONS_ERROR_CODE = 50013;
const REPORT_INSTRUCTIONS_CLEANUP_PENDING_ERROR =
  'Report panel settings were saved, but previous panel cleanup needs attention. Retry setup to finish cleanup.';
const REPORT_INSTRUCTIONS_ROLLBACK_PENDING_ERROR =
  'A report panel was published, but saving or rolling it back could not be confirmed. Existing panels were retained. Retry setup to recover the message.';
// shortcut: one bot process owns Discord writes, use a distributed lock before scaling writers.
const reportInstructionsExecutionChains = new Map<string, Promise<unknown>>();

export interface ReportInstructionsOptions {
  readonly repost?: boolean;
  readonly expectedMessageId?: string | null;
  readonly expectedChannelId?: string | null;
}

interface ReportInstructionsResult {
  action: 'sent' | 'updated' | 'recreated' | 'reposted';
  messageId: string;
}

export class ReportInstructionsError extends Error {}

export class ReportInstructionsRollbackRequiredError extends ReportInstructionsError {
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
    targetChannel: TextChannel,
    options: ReportInstructionsOptions = {}
  ): Promise<ReportInstructionsResult> {
    // Capture the panel the administrator saw before entering the serialization queue.
    // Concurrent reposts of that panel reuse the first replacement.
    if (
      options.repost &&
      (options.expectedMessageId === undefined || options.expectedChannelId === undefined)
    ) {
      const config = await this.configService.getServerConfig(guildId, {
        failOnReadError: true,
        forceRefresh: true,
      });
      options = {
        ...options,
        expectedMessageId:
          options.expectedMessageId === undefined
            ? (config.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY] ?? null)
            : options.expectedMessageId,
        expectedChannelId:
          options.expectedChannelId === undefined
            ? (config.settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY] ?? null)
            : options.expectedChannelId,
      };
    }
    return runSerializedReportInstructions(guildId, () =>
      this.upsertReportInstructionsMessageExclusive(guildId, targetChannel, options)
    );
  }

  private async upsertReportInstructionsMessageExclusive(
    guildId: string,
    targetChannel: TextChannel,
    options: ReportInstructionsOptions
  ): Promise<ReportInstructionsResult> {
    const messagePayload = this.buildReportInstructionsMessagePayload();
    const serverConfig = await this.configService.getServerConfig(guildId, {
      failOnReadError: true,
      forceRefresh: true,
    });
    this.assertExpectedReportChannel(serverConfig.settings, targetChannel.id, options);
    const matchedOriginalPanel =
      (serverConfig.settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY] ?? null) ===
      options.expectedMessageId;
    let settings = await this.recoverDurablePublication(guildId, serverConfig.settings);
    const hadPendingCleanup = Boolean(settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]);
    settings = await this.recoverMissingCleanupReplacement(guildId, settings);
    await this.retryPendingReportInstructionsCleanup(guildId, settings);
    let existingChannelId = this.reportMessageChannelId(settings);
    let existingMessageId = settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    const matchesExpectedPanel = (existingMessageId ?? null) === options.expectedMessageId;
    this.assertExpectedPanelForMove(
      matchedOriginalPanel,
      existingChannelId,
      targetChannel.id,
      options
    );
    let messageId: string;
    let createdMessage: Message | null = null;
    let action: ReportInstructionsResult['action'] = 'sent';
    const movedChannels = existingChannelId !== targetChannel.id;
    const repost = options.repost && !hadPendingCleanup && matchesExpectedPanel;

    if (repost && !existingMessageId) {
      const recoveredMessage = await this.findExistingReportInstructionsMessage(
        targetChannel,
        true
      );
      if (recoveredMessage) {
        existingChannelId = targetChannel.id;
        existingMessageId = recoveredMessage.id;
      }
    }

    if (repost) {
      const sentMessage = await this.publishReportInstructionsMessage(
        guildId,
        targetChannel,
        options
      );
      createdMessage = sentMessage;
      messageId = sentMessage.id;
      action = 'reposted';
    } else if (existingChannelId === targetChannel.id && existingMessageId) {
      const existingMessage = await this.fetchReportInstructionsMessage(
        targetChannel,
        existingMessageId
      );

      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await this.publishReportInstructionsMessage(
          guildId,
          targetChannel,
          options
        );
        createdMessage = sentMessage;
        messageId = sentMessage.id;
        action = 'recreated';
      }
    } else {
      const existingMessage = await this.findExistingReportInstructionsMessage(
        targetChannel,
        options.repost === true
      );
      if (existingMessage) {
        await existingMessage.edit(messagePayload);
        messageId = existingMessage.id;
        action = 'updated';
      } else {
        const sentMessage = await this.publishReportInstructionsMessage(
          guildId,
          targetChannel,
          options
        );
        createdMessage = sentMessage;
        messageId = sentMessage.id;
      }
    }

    const settingsPatch: Partial<ServerSettings> = {
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: targetChannel.id,
      [REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY]: targetChannel.id,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: messageId,
    };
    if (createdMessage || options.repost) {
      settingsPatch[REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY] = null;
    }
    const cleanupTarget =
      (movedChannels || repost) &&
      existingChannelId &&
      existingMessageId &&
      existingMessageId !== messageId
        ? { channelId: existingChannelId, messageId: existingMessageId }
        : null;
    if (cleanupTarget) {
      settingsPatch[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] = cleanupTarget.channelId;
      settingsPatch[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY] = cleanupTarget.messageId;
    }
    await this.saveReportInstructionsPublication(
      guildId,
      settingsPatch,
      createdMessage,
      options.repost === true
    );

    if (cleanupTarget) {
      await this.finishReportInstructionsCleanup(
        guildId,
        cleanupTarget.channelId,
        cleanupTarget.messageId
      );
    }

    return { action, messageId };
  }

  private async fetchReportInstructionsMessage(
    channel: TextChannel,
    messageId: string
  ): Promise<Message | null> {
    try {
      const message = await channel.messages.fetch({ message: messageId, force: true });
      this.assertBotOwnedMessage(message);
      return message;
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return null;
      }
      if (
        this.isUnknownDiscordResource(error, DISCORD_MISSING_ACCESS_ERROR_CODE) ||
        this.isUnknownDiscordResource(error, DISCORD_MISSING_PERMISSIONS_ERROR_CODE)
      ) {
        this.assertCanReadReportHistory(channel);
      }
      throw error;
    }
  }

  private async publishReportInstructionsMessage(
    guildId: string,
    targetChannel: TextChannel,
    options: ReportInstructionsOptions
  ): Promise<Message> {
    let afterMessageId: string | null = null;
    try {
      this.assertCanReadReportHistory(targetChannel);
      const latestMessages = await targetChannel.messages.fetch({ limit: 1 });
      this.assertCanReadReportHistory(targetChannel);
      afterMessageId = latestMessages.first()?.id ?? null;
    } catch (error) {
      if (options.repost) throw error;
      // Ordinary first setup can publish without history, but uncertain sends require recovery access.
    }
    await this.configService.updateServerSettings(guildId, {
      [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: {
        channel_id: targetChannel.id,
        after_message_id: afterMessageId,
      },
    });
    if (!options.repost) {
      return targetChannel.send(this.buildReportInstructionsMessagePayload());
    }
    // Deduplicate transport retries for this send, without reusing a deleted panel's nonce.
    const nonce = randomBytes(12).toString('hex');
    return targetChannel.send({
      ...this.buildReportInstructionsMessagePayload(),
      nonce,
      enforceNonce: true,
    });
  }

  private async saveReportInstructionsPublication(
    guildId: string,
    settingsPatch: Partial<ServerSettings>,
    createdMessage: Message | null,
    repost: boolean
  ): Promise<void> {
    try {
      await this.configService.updateServerSettings(guildId, settingsPatch);
    } catch (error) {
      if (!createdMessage) {
        throw error;
      }
      // A committed write can lose its response; confirm the saved panel before rollback.
      let savedSettings: ServerSettings;
      try {
        savedSettings = (
          await this.configService.getServerConfig(guildId, {
            failOnReadError: true,
            forceRefresh: true,
          })
        ).settings;
      } catch {
        throw new ReportInstructionsRollbackRequiredError();
      }
      if (savedSettings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY] === createdMessage.id) {
        return;
      }
      if (repost || !(await this.deleteUntrackedReportInstructionsMessage(createdMessage))) {
        throw new ReportInstructionsRollbackRequiredError();
      }
      await this.configService.updateServerSettings(guildId, {
        [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: null,
      });
      throw error;
    }
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
    const serverConfig = await this.configService.getServerConfig(guildId, {
      failOnReadError: true,
      forceRefresh: true,
    });
    const settings = await this.recoverDurablePublication(guildId, serverConfig.settings);
    const hadPendingCleanup = Boolean(
      settings[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] ||
      settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]
    );
    await this.retryPendingReportInstructionsCleanup(guildId, settings);
    const existingChannelId = this.reportMessageChannelId(settings);
    const existingMessageId = settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    const hasCleanupTarget = Boolean(existingChannelId && existingMessageId);

    await this.configService.updateServerSettings(guildId, {
      ...(settings[REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]
        ? { [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: null }
        : {}),
      [REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY]: null,
      [REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY]: null,
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
    targetChannel: TextChannel,
    repost = false
  ): Promise<Message | null> {
    if (repost) return this.findRepostReplacement(targetChannel, null);
    const botUserId = this.client.user?.id;
    if (!botUserId) {
      return null;
    }

    const messageManager = (targetChannel as { messages?: Pick<TextChannel['messages'], 'fetch'> })
      .messages;
    if (!messageManager || typeof messageManager.fetch !== 'function') {
      return null;
    }

    const messages = await messageManager.fetch({ limit: 50 }).catch(() => null);
    if (!messages) return null;
    return messages.find((message) => this.isReportInstructionsMessage(message)) ?? null;
  }

  private async findRepostReplacement(
    channel: TextChannel,
    previousMessageId: string | null
  ): Promise<Message | null> {
    let before: string | undefined;
    // Recover only messages posted after the saved publication intent.
    // shortcut: scan at most 1000 newer messages, add resumable cursors for deeper recovery.
    for (let page = 0; page < REPORT_PANEL_RECOVERY_PAGE_LIMIT; page++) {
      this.assertCanReadReportHistory(channel);
      const messages = await channel.messages.fetch({
        limit: REPORT_PANEL_RECOVERY_PAGE_SIZE,
        ...(before ? { before } : {}),
      });
      this.assertCanReadReportHistory(channel);
      const replacement = messages.find(
        (message) =>
          this.isReportInstructionsMessage(message) &&
          (!previousMessageId || BigInt(message.id) > BigInt(previousMessageId))
      );
      if (replacement) {
        return replacement;
      }
      const oldestId = messages.last()?.id;
      if (
        !oldestId ||
        messages.size < REPORT_PANEL_RECOVERY_PAGE_SIZE ||
        (previousMessageId && BigInt(oldestId) <= BigInt(previousMessageId))
      ) {
        return null;
      }
      before = oldestId;
    }
    throw new ReportInstructionsError(
      'Report panel recovery exceeded its history limit. Existing panels were retained. Finish recovery before reposting.'
    );
  }

  private async recoverDurablePublication(
    guildId: string,
    settings: ServerSettings
  ): Promise<ServerSettings> {
    const pending = settings[REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY];
    if (!pending) return settings;
    const channel = await this.client.channels.fetch(pending.channel_id).catch((error: unknown) => {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_CHANNEL_ERROR_CODE)) return null;
      throw error;
    });
    const message =
      channel && 'messages' in channel
        ? await this.findRepostReplacement(channel as TextChannel, pending.after_message_id)
        : null;
    if (!message) {
      await this.configService.updateServerSettings(guildId, {
        [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: null,
      });
      return { ...settings, [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: null };
    }
    const oldChannelId = this.reportMessageChannelId(settings);
    const oldMessageId = settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY];
    const patch: Partial<ServerSettings> = {
      [REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY]: pending.channel_id,
      [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: message.id,
      [REPORT_INSTRUCTIONS_PENDING_PUBLICATION_SETTING_KEY]: null,
    };
    if (oldChannelId && oldMessageId && oldMessageId !== message.id) {
      patch[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] = oldChannelId;
      patch[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY] = oldMessageId;
    }
    await this.saveReportInstructionsPublication(guildId, patch, message, true);
    return { ...settings, ...patch };
  }

  private assertExpectedReportChannel(
    settings: ServerSettings,
    targetChannelId: string,
    options: ReportInstructionsOptions
  ): void {
    const isCleanupRetry =
      settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY] === targetChannelId &&
      settings[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY] === options.expectedChannelId &&
      settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY] === options.expectedMessageId;
    if (
      options.repost &&
      (settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY] ?? null) !==
        options.expectedChannelId &&
      !isCleanupRetry
    ) {
      throw new ReportInstructionsError(
        'The report channel changed since this request. Refresh setup before reposting.'
      );
    }
  }

  private assertExpectedPanelForMove(
    matchedOriginalPanel: boolean,
    currentMessageChannelId: string | null,
    targetChannelId: string,
    options: ReportInstructionsOptions
  ): void {
    // Recovery may change the active ID, so validate against the state this request originally saw.
    if (options.repost && currentMessageChannelId !== targetChannelId && !matchedOriginalPanel) {
      throw new ReportInstructionsError(
        'The report panel changed since this request. Refresh setup before reposting.'
      );
    }
  }

  private async fetchTrackedReportInstructionsMessage(
    channelId: string | null | undefined,
    messageId: string | null | undefined
  ): Promise<Message | null> {
    if (!channelId || !messageId) return null;
    const channel = await this.client.channels.fetch(channelId).catch((error: unknown) => {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_CHANNEL_ERROR_CODE)) return null;
      throw error;
    });
    return channel && 'messages' in channel
      ? this.fetchReportInstructionsMessage(channel as TextChannel, messageId)
      : null;
  }

  private async recoverMissingCleanupReplacement(
    guildId: string,
    settings: ServerSettings
  ): Promise<ServerSettings> {
    if (
      settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY] &&
      settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY] &&
      !(await this.fetchTrackedReportInstructionsMessage(
        this.reportMessageChannelId(settings),
        settings[REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]
      ))
    ) {
      const previousChannelId = settings[REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY];
      const previousMessageId = settings[REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY];
      const previous = await this.fetchTrackedReportInstructionsMessage(
        previousChannelId,
        previousMessageId
      );
      const patch: Partial<ServerSettings> = {
        [REPORT_INSTRUCTIONS_CLEANUP_CHANNEL_ID_SETTING_KEY]: null,
        [REPORT_INSTRUCTIONS_CLEANUP_MESSAGE_ID_SETTING_KEY]: null,
        ...(previous
          ? {
              [REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY]: previousChannelId,
              [REPORT_INSTRUCTIONS_MESSAGE_ID_SETTING_KEY]: previous.id,
            }
          : {}),
      };
      await this.configService.updateServerSettings(guildId, patch);
      return { ...settings, ...patch };
    }
    return settings;
  }

  private assertCanReadReportHistory(channel: TextChannel): void {
    // Discord can return empty history when Read Message History is denied.
    if (
      !this.client.user ||
      !channel
        .permissionsFor(this.client.user)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    ) {
      throw new ReportInstructionsError(
        'Drasil needs View Channel and Read Message History to inspect, repair, repost, or recover an existing report panel. Existing panels were retained.'
      );
    }
  }

  private reportMessageChannelId(settings: ServerSettings): string | null {
    // Existing panels used the configured channel as their parent before this field was introduced.
    return (
      settings[REPORT_INSTRUCTIONS_MESSAGE_CHANNEL_ID_SETTING_KEY] ??
      settings[REPORT_INSTRUCTIONS_CHANNEL_ID_SETTING_KEY] ??
      null
    );
  }

  private assertBotOwnedMessage(message: Message): void {
    if (!this.isReportInstructionsMessage(message)) {
      throw new ReportInstructionsError(
        'The saved message is not a Drasil report panel. No message was changed.'
      );
    }
  }

  private isReportInstructionsMessage(message: Message): boolean {
    return Boolean(
      this.client.user &&
      message.author.id === this.client.user.id &&
      message.embeds.some((embed) => embed.title === 'Report a User') &&
      message.components.some(
        (row) =>
          'components' in row &&
          row.components.some(
            (component) => 'customId' in component && component.customId === 'report_user_initiate'
          )
      )
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
      throw new ReportInstructionsError(REPORT_INSTRUCTIONS_CLEANUP_PENDING_ERROR);
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
      existingMessage = await existingChannel.messages.fetch({ message: messageId, force: true });
    } catch (error) {
      if (this.isUnknownDiscordResource(error, DISCORD_UNKNOWN_MESSAGE_ERROR_CODE)) {
        return true;
      }
      console.warn('Failed to fetch stale report instructions message:', error);
      return false;
    }
    try {
      this.assertBotOwnedMessage(existingMessage);
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
