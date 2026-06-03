import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  MessageContextMenuCommandInteraction,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
  UserContextMenuCommandInteraction,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { ISecurityActionService } from '../services/SecurityActionService';
import {
  getUserReportSettings,
  REPORT_MESSAGE_MODAL_PREFIX,
  REPORT_MESSAGE_REASON_FIELD_ID,
  USER_REPORT_REASON_MAX_LENGTH,
} from '../utils/userReportSettings';
import { isUserInstallReportingEnabled } from '../utils/userInstallReporting';
import { ReportInstructionsManager } from './ReportInstructionsManager';

type ReplyGuildInstallRequired = (
  interaction: ChatInputCommandInteraction | UserContextMenuCommandInteraction
) => Promise<void>;

export class ReportCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly securityActionService: ISecurityActionService,
    private readonly reportInstructionsManager: ReportInstructionsManager,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {}

  public async handleReportCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: 'You cannot report yourself.',
      });
      return;
    }

    let reportSettings = getUserReportSettings();
    try {
      const serverConfig = await this.configService.getServerConfig(guild.id);
      reportSettings = getUserReportSettings(serverConfig.settings);
    } catch (error) {
      console.error(`Failed to load report settings for guild ${guild.id}:`, error);
    }

    if (reportSettings.reasonRequired && !reason) {
      await interaction.editReply({
        content: 'Please include a reason for this report.',
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: `Could not find ${targetUser.globalName ?? targetUser.username} in this server.`,
      });
      return;
    }

    try {
      await this.securityActionService.handleUserReport(member, interaction.user, reason);
      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUser.id}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle user report for ${targetUser.id}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  public async handleReportUserContextCommand(
    interaction: UserContextMenuCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.targetUser;
    if (targetUser.id === interaction.user.id) {
      await interaction.editReply({
        content: 'You cannot report yourself.',
      });
      return;
    }

    let reportSettings = getUserReportSettings();
    try {
      const serverConfig = await this.configService.getServerConfig(guild.id);
      reportSettings = getUserReportSettings(serverConfig.settings);
    } catch (error) {
      console.error(`Failed to load report settings for guild ${guild.id}:`, error);
    }

    if (reportSettings.reasonRequired) {
      await interaction.editReply({
        content: 'This server requires a report reason. Please use `/report` instead.',
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.editReply({
        content: `Could not find ${targetUser.globalName ?? targetUser.username} in this server.`,
      });
      return;
    }

    try {
      await this.securityActionService.handleUserReport(member, interaction.user);
      await interaction.editReply({
        content: `Thank you for your report regarding <@${targetUser.id}>. It has been submitted for review.`,
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to handle context user report for ${targetUser.id}:`, error);
      await interaction.editReply({
        content: 'An error occurred while submitting your report. Please try again later.',
      });
    }
  }

  public async handleReportMessageContextCommand(
    interaction: MessageContextMenuCommandInteraction
  ): Promise<void> {
    if (!isUserInstallReportingEnabled()) {
      await interaction.reply({
        content: 'User-installable message reporting is not enabled for this Drasil deployment.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetMessage = interaction.targetMessage;
    const targetUser = targetMessage.author;
    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        content: 'You cannot report your own message.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guildId = interaction.guildId ?? undefined;
    let reasonRequired = false;
    if (guildId) {
      let reportSettings = getUserReportSettings();
      try {
        const serverConfig = await this.configService.getServerConfig(guildId);
        reportSettings = getUserReportSettings(serverConfig.settings);
      } catch (error) {
        console.error(`Failed to load report settings for guild ${guildId}:`, error);
      }

      reasonRequired = reportSettings.reasonRequired;
    }

    const context = interaction.context ?? 'x';
    const modal = new ModalBuilder()
      .setCustomId(
        [
          REPORT_MESSAGE_MODAL_PREFIX,
          targetMessage.id,
          interaction.channelId,
          targetUser.id,
          guildId ?? '0',
          context,
        ].join(':')
      )
      .setTitle('Report Message');
    const reasonInput = new TextInputBuilder()
      .setCustomId(REPORT_MESSAGE_REASON_FIELD_ID)
      .setLabel('Reason')
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder('What happened? Include extra context if useful.')
      .setMaxLength(USER_REPORT_REASON_MAX_LENGTH)
      .setRequired(reasonRequired);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
    await interaction.showModal(modal);
  }

  public async handleSetupReportButtonCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'The specified channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetChannel = channel as TextChannel;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await this.reportInstructionsManager.upsertReportInstructionsMessage(
        guild.id,
        targetChannel
      );

      await interaction.editReply({
        content: `Report instructions ${result.action} successfully in ${channel}.`,
      });
    } catch (error) {
      console.error('Failed to upsert report button message:', error);
      await interaction.editReply({
        content:
          '❌ Failed to send or update the message. Please ensure the bot has permissions to send messages in that channel.',
      });
    }
  }
}
