import {
  Client,
  Message,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder, // Added
  ButtonBuilder, // Added
  ButtonStyle, // Added
  ChannelType, // Added
  EmbedBuilder, // Added
  TextChannel, // Added
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { IHeuristicService } from '../services/HeuristicService';
import { UserProfileData } from '../services/GPTService';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { INotificationManager } from '../services/NotificationManager';
import { HeuristicSettings, IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
import { IUserModerationService } from '../services/UserModerationService';
import { ISecurityActionService } from '../services/SecurityActionService';
import { TYPES } from '../di/symbols';
import 'reflect-metadata';

// Load environment variables
dotenv.config();

/**
 * Interface for the Bot class
 */
export interface ICommandHandler {
  /**
   * Register the commands for the bot
   */
  registerCommands(): Promise<void>;

  /**
   * Handle a slash command
   */
  handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void>;

  // TODO: Rip this out in favor of a slash command
  /**
   * Handle test commands
   */
  handleTestCommands(message: Message): Promise<void>;
}

@injectable()
export class CommandHandler implements ICommandHandler {
  private client: Client;
  private heuristicService: IHeuristicService;
  private detectionOrchestrator: IDetectionOrchestrator;
  private notificationManager: INotificationManager;
  private configService: IConfigService;
  private userModerationService: IUserModerationService;
  private securityActionService: ISecurityActionService;
  private commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.HeuristicService) heuristicService: IHeuristicService,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService
  ) {
    this.client = client;
    this.heuristicService = heuristicService;
    this.detectionOrchestrator = detectionOrchestrator;
    this.notificationManager = notificationManager;
    this.configService = configService;
    this.userModerationService = userModerationService;
    this.securityActionService = securityActionService;

    // Define slash commands
    this.commands = [
      new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to ban').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Reason for the ban').setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
      new SlashCommandBuilder()
        .setName('setupverification')
        .setDescription('Set up a dedicated verification channel for restricted users'),
      new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure server settings')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('set')
            .setDescription('Update a general server configuration value')
            .addStringOption((option) =>
              option
                .setName('key')
                .setDescription('The configuration key to update')
                .setRequired(true)
                .addChoices(
                  { name: 'Restricted Role ID', value: 'restricted_role_id' },
                  { name: 'Admin Channel ID', value: 'admin_channel_id' },
                  { name: 'Verification Channel ID', value: 'verification_channel_id' },
                  { name: 'Admin Notification Role ID', value: 'admin_notification_role_id' }
                )
            )
            .addStringOption((option) =>
              option.setName('value').setDescription('The value to set').setRequired(true)
            )
        )
        .addSubcommandGroup((group) =>
          group
            .setName('heuristic')
            .setDescription('Manage heuristic detection settings')
            .addSubcommand((subcommand) =>
              subcommand.setName('view').setDescription('View the current heuristic configuration')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('set-threshold')
                .setDescription('Set the message threshold for frequency detection')
                .addIntegerOption((option) =>
                  option
                    .setName('value')
                    .setDescription('Messages allowed in the configured timeframe (1-100)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(100)
                )
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('set-timeframe')
                .setDescription('Set the timeframe in seconds for frequency detection')
                .addIntegerOption((option) =>
                  option
                    .setName('value')
                    .setDescription('Timeframe in seconds (1-600)')
                    .setRequired(true)
                    .setMinValue(1)
                    .setMaxValue(600)
                )
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('keywords-list')
                .setDescription('List configured suspicious keywords')
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('keywords-add')
                .setDescription('Add a suspicious keyword')
                .addStringOption((option) =>
                  option
                    .setName('keyword')
                    .setDescription('Keyword or phrase to add')
                    .setRequired(true)
                )
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('keywords-remove')
                .setDescription('Remove a suspicious keyword')
                .addStringOption((option) =>
                  option
                    .setName('keyword')
                    .setDescription('Keyword or phrase to remove')
                    .setRequired(true)
                )
            )
            .addSubcommand((subcommand) =>
              subcommand
                .setName('keywords-reset')
                .setDescription('Reset suspicious keywords to defaults')
            )
            .addSubcommand((subcommand) =>
              subcommand.setName('reset').setDescription('Reset all heuristic settings to defaults')
            )
        ),
      new SlashCommandBuilder() // Added flaguser command
        .setName('flaguser')
        .setDescription('Manually flag a user as suspicious and start verification.')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to flag').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Optional reason for flagging').setRequired(false)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Require Admin perms
      new SlashCommandBuilder() // Added setupreportbutton command
        .setName('setupreportbutton')
        .setDescription('Sends the message containing the "Report User" button to a channel.')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel to send the report button message to.')
            .addChannelTypes(ChannelType.GuildText) // Only allow text channels
            .setRequired(true)
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator), // Require Admin perms
    ].map((command) => command.toJSON());
  }

  public async registerCommands(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;

    if (!token) {
      console.error('DISCORD_TOKEN is not set in environment variables');
      return;
    }

    try {
      const rest = new REST({ version: '10' }).setToken(token);

      // Register commands globally (for all guilds)
      const clientId = this.client.user?.id;

      if (!clientId) {
        console.error('Client ID not available');
        return;
      }

      console.log('Started refreshing application (/) commands.');

      await rest.put(Routes.applicationCommands(clientId), { body: this.commands });

      console.log('Successfully registered application commands.');
    } catch (error) {
      console.error('Failed to register commands:', error);
    }
  }

  public async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    switch (commandName) {
      case 'ban':
        await this.handleBanCommand(interaction);
        break;

      case 'setupverification':
        await this.handleSetupVerificationCommand(interaction);
        break;

      case 'config':
        await this.handleConfigCommand(interaction);
        break;

      case 'flaguser': // Added case for flaguser
        await this.handleFlagUserCommand(interaction);
        break;

      case 'setupreportbutton': // Added case for setupreportbutton
        await this.handleSetupReportButtonCommand(interaction);
        break;

      default:
        await interaction.reply({
          content: `Unknown command: ${commandName}`,
          flags: MessageFlags.Ephemeral,
        });
    }
  }

  private async handleBanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Get the target user
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to ban.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the reason if provided
    const reason = interaction.options.getString('reason') || 'No reason provided';

    // Get the GuildMember
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Permission gate (defaultMemberPermissions is not a security boundary)
    // Prefer `interaction.memberPermissions` since it includes channel-level overrides.
    let hasBanPermission = interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
    if (hasBanPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasBanPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.BanMembers)
        : false;
    }

    if (!hasBanPermission) {
      await interaction.reply({
        content: 'You need Ban Members permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await this.userModerationService.banUser(member, reason, interaction.user);
      await interaction.reply({
        content: `User ${targetUser.tag} has been banned.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to ban user via command:', error);
      await interaction.reply({
        content: `Failed to ban ${targetUser.tag}. Please try again later.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Helper method to extract user profile data for GPT analysis
   * Only includes data directly available through Discord.js API
   */
  private extractUserProfileData(member: GuildMember): UserProfileData {
    return {
      username: member.user.username,
      discriminator: member.user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(member.user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      recentMessages: [],
    };
  }

  /**
   * Handles test commands for debugging and testing the bot
   */
  public async handleTestCommands(message: Message): Promise<void> {
    const args = message.content.split(' ');
    const testCommand = args[1]?.toLowerCase();

    if (!testCommand) {
      await message.reply(
        'Available test commands: `!test spam`, `!test newaccount`, `!test spamwords`'
      );
      return;
    }

    try {
      // Declare test variables outside switch to avoid lexical declaration errors
      let newAccountProfile: UserProfileData;
      let newAccountResult;
      let spamMessage: string;
      let spamResult;

      if (!message.member) {
        await message.reply('This command can only be used in a server.');
        return;
      }

      switch (testCommand) {
        case 'spam':
          // Simulate message frequency spam
          if (!message.guildId) {
            await message.reply('This command can only be used in a server.');
            return;
          }
          for (let i = 0; i < 10; i++) {
            this.heuristicService.isFrequencyAboveThreshold(message.author.id, message.guildId);
          }
          await message.reply(
            'Simulated rapid message frequency. Next message should trigger detection.'
          );
          break;

        case 'newaccount':
          // Create a simulated profile with recent account creation
          newAccountProfile = {
            ...this.extractUserProfileData(message.member),
            accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old account
            joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
          };

          // Analyze with this profile
          newAccountResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            'Test message with simulated new account',
            newAccountProfile
          );

          await message.reply(
            `Test result: ${newAccountResult.label}\n` +
              `Confidence: ${(newAccountResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${newAccountResult.reasons.join(', ')}\n`
          );
          break;

        case 'spamwords':
          // Test with known spam keywords
          spamMessage = 'free discord nitro gift card claim your prize now';
          spamResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            spamMessage,
            this.extractUserProfileData(message.member)
          );

          await message.reply(
            `Test message: "${spamMessage}"\n` +
              `Result: ${spamResult.label}\n` +
              `Confidence: ${(spamResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${spamResult.reasons.join(', ')}\n`
          );
          break;

        default:
          await message.reply(
            'Unknown test command. Available commands: `!test spam`, `!test newaccount`, `!test spamwords`'
          );
      }
    } catch (error) {
      console.error('Error in test command:', error);
      await message.reply('An error occurred while executing the test command.');
    }
  }

  // TODO: We don't really *need* this functionality right now, but I'm leaving it around
  // TODO cont: because it will be useful in the future for the setup wizard flow
  private async handleSetupVerificationCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to set up the verification channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Defer the reply as the channel creation might take a moment
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Get the restricted role ID
    // Get the server configuration
    const serverConfig = await this.configService.getServerConfig(guild.id);

    // Use the restricted role ID from the database
    const restrictedRoleId = serverConfig.restricted_role_id;

    // If no restricted role ID is found, prompt the user to set it
    if (!restrictedRoleId) {
      await interaction.editReply({
        content: 'No restricted role ID configured. Please set up the restricted role first.',
      });
      return;
    }

    // Create the verification channel
    const channelId = await this.notificationManager.setupVerificationChannel(
      guild,
      restrictedRoleId
    );

    if (channelId) {
      await interaction.editReply({
        content: `✅ Verification channel created successfully! Channel ID: ${channelId}`,
      });

      // Update the environment variable or configuration
      // Update the configuration in the database
      await this.configService.updateServerConfig(guild.id, {
        verification_channel_id: channelId,
      });
      console.log(`Verification channel created with ID: ${channelId}`);
    } else {
      await interaction.editReply({
        content:
          "❌ Failed to create verification channel. Please check the bot's permissions and try again.",
      });
    }
  }

  /**
   * Handle the /config command to update server configuration
   * @param interaction The slash command interaction
   */
  private async handleConfigCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to configure the bot.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    if (subcommandGroup === 'heuristic') {
      await this.handleHeuristicConfigCommand(interaction, guild.id);
      return;
    }

    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand !== 'set') {
      await interaction.reply({
        content: 'Unsupported /config subcommand.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    try {
      await this.configService.updateServerConfig(guild.id, {
        [key]: value,
      });

      await interaction.reply({
        content: `✅ Configuration updated successfully!\n\`${key}\` has been set to \`${value}\``,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error(`Failed to update configuration for guild ${guild.id}:`, error);
      await interaction.reply({
        content: 'An error occurred while updating the configuration. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  private formatKeywordSummary(keywords: readonly string[]): string {
    if (keywords.length === 0) {
      return '(none configured)';
    }

    const preview = keywords
      .slice(0, 20)
      .map((keyword) => `\`${keyword}\``)
      .join(', ');
    if (keywords.length <= 20) {
      return preview;
    }

    return `${preview}, ... (+${keywords.length - 20} more)`;
  }

  private formatHeuristicSettings(settings: HeuristicSettings): string {
    const timeframeSeconds = settings.timeWindowMs / 1000;
    return [
      `Threshold: \`${settings.messageThreshold}\` messages`,
      `Timeframe: \`${timeframeSeconds}\` seconds`,
      `Keywords (${settings.suspiciousKeywords.length}): ${this.formatKeywordSummary(settings.suspiciousKeywords)}`,
    ].join('\n');
  }

  private async handleHeuristicConfigCommand(
    interaction: ChatInputCommandInteraction,
    guildId: string
  ): Promise<void> {
    const subcommand = interaction.options.getSubcommand(true);

    try {
      switch (subcommand) {
        case 'view': {
          const settings = await this.configService.getHeuristicSettings(guildId);
          await interaction.reply({
            content: `Current heuristic settings:\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-threshold': {
          const value = interaction.options.getInteger('value', true);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            messageThreshold: value,
          });
          await interaction.reply({
            content: `✅ Updated heuristic threshold.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'set-timeframe': {
          const value = interaction.options.getInteger('value', true);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            timeframeSeconds: value,
          });
          await interaction.reply({
            content: `✅ Updated heuristic timeframe.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-list': {
          const settings = await this.configService.getHeuristicSettings(guildId);
          await interaction.reply({
            content: `Suspicious keywords (${settings.suspiciousKeywords.length}): ${this.formatKeywordSummary(
              settings.suspiciousKeywords
            )}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-add': {
          const keyword = interaction.options.getString('keyword', true).trim();
          if (!keyword) {
            await interaction.reply({
              content: 'Keyword cannot be empty.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const current = await this.configService.getHeuristicSettings(guildId);
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: [...current.suspiciousKeywords, keyword],
          });
          await interaction.reply({
            content: `✅ Added suspicious keyword.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-remove': {
          const keyword = interaction.options.getString('keyword', true).trim().toLowerCase();
          if (!keyword) {
            await interaction.reply({
              content: 'Keyword cannot be empty.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const current = await this.configService.getHeuristicSettings(guildId);
          const remaining = current.suspiciousKeywords.filter((existing) => existing !== keyword);

          if (remaining.length === current.suspiciousKeywords.length) {
            await interaction.reply({
              content: `Keyword \`${keyword}\` is not in the configured list.`,
              flags: MessageFlags.Ephemeral,
            });
            return;
          }

          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: remaining,
          });
          await interaction.reply({
            content: `✅ Removed suspicious keyword.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'keywords-reset': {
          const settings = await this.configService.updateHeuristicSettings(guildId, {
            suspiciousKeywords: [...globalConfig.getSettings().defaultSuspiciousKeywords],
          });
          await interaction.reply({
            content: `✅ Reset suspicious keywords to defaults.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        case 'reset': {
          const settings = await this.configService.resetHeuristicSettings(guildId);
          await interaction.reply({
            content: `✅ Reset all heuristic settings to defaults.\n${this.formatHeuristicSettings(settings)}`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        default:
          await interaction.reply({
            content: 'Unsupported heuristic subcommand.',
            flags: MessageFlags.Ephemeral,
          });
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while updating heuristic settings.';
      await interaction.reply({
        content: `Failed to update heuristic settings: ${errorMessage}`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle the /flaguser command to manually flag a user
   * @param interaction The slash command interaction
   */
  private async handleFlagUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Double-check permissions (though defaultMemberPermissions should handle this)
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the target user
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason'); // Optional

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await this.securityActionService.handleManualFlag(
        targetMember,
        interaction.user,
        reason ?? undefined
      );
      await interaction.reply({
        content: `Flag request for ${targetUser.tag} received. Initiating verification process...`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to manually flag user:', error);
      await interaction.reply({
        content: `Failed to flag ${targetUser.tag}. Please try again later.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Handle the /setupreportbutton command
   * @param interaction The slash command interaction
   */
  private async handleSetupReportButtonCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Double-check permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Get the target channel
    const channel = interaction.options.getChannel('channel', true);

    // Ensure it's a text channel (though the option restricts this)
    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'The specified channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetChannel = channel as TextChannel;

    // Create the embed
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('Report a User')
      .setDescription(
        'If you see a user violating server rules or engaging in suspicious activity, ' +
          'please use the button below to submit a report. ' +
          'Your report will be reviewed by the moderation team.'
      )
      .setFooter({ text: 'Your reports help keep the community safe!' });

    // Create the button
    const reportButton = new ButtonBuilder()
      .setCustomId('report_user_initiate') // Unique ID for the button interaction
      .setLabel('Report User')
      .setStyle(ButtonStyle.Danger) // Use Danger style for reporting
      .setEmoji('⚠️'); // Optional emoji

    // Create an action row for the button
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(reportButton);

    try {
      // Send the message to the target channel
      await targetChannel.send({ embeds: [embed], components: [row] });

      // Confirm to the admin
      await interaction.reply({
        content: `✅ Report button message sent successfully to ${channel}.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('Failed to send report button message:', error);
      await interaction.reply({
        content:
          '❌ Failed to send the message. Please ensure the bot has permissions to send messages in that channel.',
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
