import {
  Client,
  Message,
  GuildMember,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Interaction,
  ButtonInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  ThreadChannel,
  PermissionFlagsBits,
  Guild,
} from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { IHeuristicService } from '../services/HeuristicService';
import { UserProfileData } from '../services/GPTService';
import { IDetectionOrchestrator } from '../services/DetectionOrchestrator';
import { IRoleManager } from '../services/RoleManager';
import { INotificationManager } from '../services/NotificationManager';
import { IConfigService } from '../config/ConfigService';
import { globalConfig } from '../config/GlobalConfig';
import { ISecurityActionService } from '../services/SecurityActionService';
import { IUserModerationService } from '../services/UserModerationService';
import { TYPES } from '../di/symbols';
import { IVerificationService } from '../services/VerificationService';
import { VerificationStatus, VerificationEvent } from '../repositories/types';
import { VerificationHistoryFormatter } from '../utils/VerificationHistoryFormatter';
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
}

@injectable()
export class CommandHandler implements ICommandHandler {
  private client: Client;
  private heuristicService: IHeuristicService;
  private detectionOrchestrator: IDetectionOrchestrator;
  private roleManager: IRoleManager;
  private notificationManager: INotificationManager;
  private configService: IConfigService;
  private securityActionService: ISecurityActionService;
  private userModerationService: IUserModerationService;
  private commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];
  private verificationService: IVerificationService;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.HeuristicService) heuristicService: IHeuristicService,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService,
    @inject(TYPES.VerificationService) verificationService: IVerificationService
  ) {
    this.client = client;
    this.heuristicService = heuristicService;
    this.detectionOrchestrator = detectionOrchestrator;
    this.roleManager = roleManager;
    this.notificationManager = notificationManager;
    this.configService = configService;
    this.securityActionService = securityActionService;
    this.userModerationService = userModerationService;
    this.verificationService = verificationService;

    // Define slash commands
    this.commands = [
      new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Verify a user (remove restricted role)')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to verify').setRequired(true)
        ),
      new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to ban').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('reason').setDescription('Reason for the ban').setRequired(false)
        ),
      new SlashCommandBuilder()
        .setName('createthread')
        .setDescription('Create a verification thread for a user')
        .addUserOption((option) =>
          option.setName('user').setDescription('The user to create a thread for').setRequired(true)
        ),
      new SlashCommandBuilder().setName('ping').setDescription('Check if the bot is running'),
      new SlashCommandBuilder()
        .setName('setupverification')
        .setDescription('Set up a dedicated verification channel for restricted users'),
      new SlashCommandBuilder()
        .setName('listthreads')
        .setDescription('List all open verification threads in this server'),
      new SlashCommandBuilder()
        .setName('resolvethread')
        .setDescription('Mark a verification thread as resolved')
        .addStringOption((option) =>
          option
            .setName('threadid')
            .setDescription('The ID of the thread to resolve')
            .setRequired(true)
        )
        .addStringOption((option) =>
          option
            .setName('resolution')
            .setDescription('How the thread was resolved')
            .setRequired(true)
            .addChoices(
              { name: 'Verified', value: 'verified' },
              { name: 'Banned', value: 'banned' },
              { name: 'Ignored', value: 'ignored' }
            )
        ),
      new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure server settings')
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
        ),
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

  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.handleSlashCommand(interaction);
      } else if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      }
    } catch (error) {
      console.error('Error handling interaction:', error);

      // Try to respond if the interaction hasn't been replied to
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing this interaction.',
          ephemeral: true,
        });
      }
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    switch (commandName) {
      case 'ping':
        await interaction.reply('Pong!');
        break;

      case 'verify':
        await this.handleVerifyCommand(interaction);
        break;

      case 'ban':
        await this.handleBanCommand(interaction);
        break;

      case 'createthread':
        await this.handleCreateThreadCommand(interaction);
        break;

      case 'setupverification':
        await this.handleSetupVerificationCommand(interaction);
        break;

      case 'config':
        await this.handleConfigCommand(interaction);
        break;

      case 'listthreads':
        await this.handleListThreadsCommand(interaction);
        break;

      case 'resolvethread':
        await this.handleResolveThreadCommand(interaction);
        break;

      default:
        await interaction.reply({
          content: `Unknown command: ${commandName}`,
          ephemeral: true,
        });
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const [action, targetUserId] = interaction.customId.split('_');
    if (!interaction.guildId) {
      await interaction.reply({
        content: 'This button can only be used in a server.',
        ephemeral: true,
      });
      return;
    }
    const guildId = interaction.guildId;

    try {
      switch (action) {
        case 'verify':
          await this.handleVerifyButton(interaction, guildId, targetUserId);
          break;
        case 'ban':
          await this.handleBanButton(interaction, guildId, targetUserId);
          break;
        case 'thread':
          await this.handleThreadButton(interaction, guildId, targetUserId);
          break;
        case 'history':
          await this.handleHistoryButton(interaction, guildId, targetUserId);
          break;
        case 'reopen':
          await this.handleReopenButton(interaction, guildId, targetUserId);
          break;
        default:
          await interaction.reply({
            content: 'Unknown button action',
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      await interaction.reply({
        content: 'An error occurred while processing your request.',
        ephemeral: true,
      });
    }
  }

  private async handleVerifyButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Verify the user using VerificationService
      await this.verificationService.verifyUser(
        member, // Pass the GuildMember object
        interaction.user.id,
        'Verified via button interaction'
      );

      // Log the verification action to the original message embed (updates text and color)
      await this.notificationManager.logActionToMessage(
        interaction.message as Message,
        'verified the user', // Action text
        interaction.user, // Admin user who clicked
        undefined // No thread involved in verification itself
      );

      // Update the buttons to show History and Reopen
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        VerificationStatus.VERIFIED
      );

      // Lock and archive the thread if it exists
      await this.manageThreadState(guildId, userId, true, true); // Lock and Archive on Verify

      await interaction.followUp({
        content: `User <@${userId}> has been verified and can now access the server.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error verifying user:', error);
      await interaction.followUp({
        content: 'An error occurred while verifying the user.',
        ephemeral: true,
      });
    }
  }

  private async handleBanButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Reject the verification using VerificationService
      await this.verificationService.rejectUser(
        member, // Pass the GuildMember object
        interaction.user.id,
        'Banned via button interaction'
      );

      // Ban the user via Discord API (VerificationService doesn't ban)
      await member.ban({ reason: 'Banned by moderator during verification (button)' });

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        VerificationStatus.REJECTED
      );

      // Lock and archive the thread if it exists
      await this.manageThreadState(guildId, userId, true, true); // Lock and Archive on Ban

      await interaction.followUp({
        content: `User <@${userId}> has been banned from the server.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error banning user:', error);
      await interaction.followUp({
        content: 'An error occurred while banning the user.',
        ephemeral: true,
      });
    }
  }

  private async handleThreadButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild and member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId).catch(() => null);

      if (!member) {
        throw new Error('Could not find member in guild');
      }

      // Create the thread
      const thread = await this.notificationManager.createVerificationThread(member);

      if (!thread) {
        throw new Error('Failed to create verification thread');
      }

      // Get the active verification event
      const verificationEvent = await this.verificationService.getActiveVerification(
        guildId,
        userId
      );

      let updatedEvent: VerificationEvent | null = null;
      if (verificationEvent) {
        // Attach thread to verification event
        updatedEvent = await this.verificationService.attachThreadToVerification(
          verificationEvent.id,
          thread.id
        );
      } else {
        console.warn(
          `No active verification event found for user ${userId} after creating thread ${thread.id}. Cannot link thread.`
        );
        // Optionally handle this case, e.g., create a new event here if needed
      }

      // Log the action to the message embed (adds the thread link field)
      await this.notificationManager.logActionToMessage(
        interaction.message as Message,
        'created a verification thread',
        interaction.user,
        thread
      );

      // Update the buttons (this will remove the Create Thread button)
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        updatedEvent?.status || VerificationStatus.PENDING // Use updated status or default to PENDING
      );

      await interaction.followUp({
        content: `Created verification thread: ${thread.url}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error creating verification thread:', error);
      await interaction.followUp({
        content: 'An error occurred while creating the verification thread.',
        ephemeral: true,
      });
    }
  }

  private async handleHistoryButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Get verification history with actions using the member object
      const history = await this.verificationService.getVerificationHistory(member);

      // Format history using our formatter
      const formattedHistory = VerificationHistoryFormatter.formatForDiscord(history, userId);

      // Send as a text file if it's too long
      if (formattedHistory.length > 2000) {
        const plainTextHistory = VerificationHistoryFormatter.formatForFile(history, userId);
        const buffer = Buffer.from(plainTextHistory, 'utf-8');
        await interaction.editReply({
          content: 'Here is the complete verification history:',
          files: [
            {
              attachment: buffer,
              name: `verification-history-${userId}.txt`,
            },
          ],
        });
      } else {
        await interaction.editReply({
          content: formattedHistory,
        });
      }
    } catch (error) {
      console.error('Error fetching verification history:', error);
      await interaction.editReply({
        content: 'An error occurred while fetching the verification history.',
      });
    }
  }

  private async handleReopenButton(
    interaction: ButtonInteraction,
    guildId: string,
    userId: string
  ): Promise<void> {
    await interaction.deferUpdate();

    try {
      // Get the guild member
      const guild = await this.client.guilds.fetch(guildId);
      const member = await guild.members.fetch(userId);
      if (!member) throw new Error('Member not found');

      // Reopen the verification using VerificationService
      await this.verificationService.reopenVerification(
        member, // Pass the GuildMember object
        interaction.user.id,
        'Reopened via button interaction'
      );

      // Update the notification message buttons
      await this.notificationManager.updateNotificationButtons(
        interaction.message as Message,
        userId,
        VerificationStatus.PENDING // Set back to PENDING
      );

      // Unlock and unarchive the thread if it exists
      await this.manageThreadState(guildId, userId, false, false); // Unlock and Unarchive on Reopen

      await interaction.followUp({
        content: `Verification for <@${userId}> has been reopened. The user has been restricted again.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error reopening verification:', error);
      await interaction.followUp({
        content: 'An error occurred while reopening the verification.',
        ephemeral: true,
      });
    }
  }

  private async handleVerifyCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Get the target user
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to verify.',
        ephemeral: true,
      });
      return;
    }

    // Get the GuildMember
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        ephemeral: true,
      });
      return;
    }

    // Verify the user
    const success = await this.userModerationService.verifyUser(member, interaction.user);
    if (success) {
      await interaction.reply({
        content: `✅ User ${member.user.tag} has been verified and the restricted role has been removed.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Failed to verify ${member.user.tag}. Please check the bot's permissions and role configuration.`,
        ephemeral: true,
      });
    }
  }

  private async handleBanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Get the target user
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to ban.',
        ephemeral: true,
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
        ephemeral: true,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        ephemeral: true,
      });
      return;
    }

    // Ban the user
    const success = await this.userModerationService.banUser(member, reason, interaction.user);
    if (success) {
      await interaction.reply({
        content: `🚫 User ${member.user.tag} has been banned. Reason: ${reason}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Failed to ban ${member.user.tag}. Please check the bot's permissions.`,
        ephemeral: true,
      });
    }
  }

  private async handleCreateThreadCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Get the target user
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to create a thread for.',
        ephemeral: true,
      });
      return;
    }

    // Get the GuildMember
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        ephemeral: true,
      });
      return;
    }

    // Create a verification thread
    await this.createVerificationThread(member, interaction);
  }

  private async createVerificationThread(
    member: GuildMember,
    interaction: ChatInputCommandInteraction | ButtonInteraction
  ): Promise<ThreadChannel | null> {
    // Delegate thread creation to the SecurityActionService
    const thread = await this.securityActionService.createVerificationThreadForMember(
      member,
      undefined, // No notification message to update
      interaction.user // The user who requested the thread creation
    );

    if (thread) {
      await interaction.reply({
        content: `✅ Created a verification thread for ${member.user.tag}.`,
        ephemeral: true,
      });
      return thread;
    } else {
      await interaction.reply({
        content: `❌ Failed to create a verification thread for ${member.user.tag}. Please check the bot's permissions and channel configuration.`,
        ephemeral: true,
      });
      return null;
    }
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore messages from bots (including self)
    if (message.author.bot) return;

    // Handle ping command via traditional message (kept for backward compatibility)
    if (message.content === '!ping') {
      await message.reply('Pong! Note: Please use slash commands instead (e.g. /ping)');
      return;
    }

    // Handle debug/test commands
    if (message.content.startsWith('!test')) {
      await this.handleTestCommands(message);
      return;
    }

    // Extract user data for detection
    const userId = message.author.id;
    const serverId = message.guild?.id;
    const content = message.content;

    try {
      // Get user profile data if available
      let profileData: UserProfileData | undefined;

      // Only collect profile data if we have access to the user and guild member
      if (message.member && message.author) {
        profileData = this.extractUserProfileData(message.member);
      }

      // Use the detection orchestrator to analyze the message
      const detectionResult = await this.detectionOrchestrator.detectMessage(
        serverId || 'DM',
        userId,
        content,
        profileData
      );

      // If suspicious, delegate to the SecurityActionService
      if (detectionResult.label === 'SUSPICIOUS' && message.member) {
        await this.securityActionService.handleSuspiciousMessage(
          message.member,
          detectionResult,
          message
        );
      }
    } catch (error) {
      console.error('Error detecting spam:', error);
      console.error(
        `Details: serverId=${serverId}, userId=${userId}, content length=${content.length}`
      );
      if (error instanceof Error) {
        console.error(
          `Error name: ${error.name}, message: ${error.message}, stack: ${error.stack}`
        );
      }
    }
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      console.log(`New member joined: ${member.user.tag} (${member.id})`);

      // Extract profile data
      const profileData = this.extractUserProfileData(member);

      // Run detection on new join
      const detectionResult = await this.detectionOrchestrator.detectNewJoin(
        member.guild.id,
        member.id,
        profileData
      );

      // If suspicious, delegate to the SecurityActionService
      if (detectionResult.label === 'SUSPICIOUS') {
        await this.securityActionService.handleSuspiciousJoin(member, detectionResult);
      }
    } catch (error) {
      console.error('Error handling new member:', error);
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
  private async handleTestCommands(message: Message): Promise<void> {
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
          for (let i = 0; i < 10; i++) {
            this.heuristicService.isFrequencyAboveThreshold(message.author.id);
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
        ephemeral: true,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to set up the verification channel.',
        ephemeral: true,
      });
      return;
    }

    // Defer the reply as the channel creation might take a moment
    await interaction.deferReply({ ephemeral: true });

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
   * Initialize server configurations for all guilds the bot is in
   */
  private async initializeServers(): Promise<void> {
    if (!this.client.user) {
      console.error('Client user not available');
      return;
    }

    console.log('Initializing server configurations...');

    // Get all guilds the bot is in
    const guilds = this.client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        // This will create a default configuration if one doesn't exist
        const config = await this.configService.getServerConfig(guildId);

        // Initialize services with the server configuration
        await this.roleManager.initialize(guildId);
        await this.notificationManager.initialize(guildId);
        await this.securityActionService.initialize(guildId);

        // Update the services with the configuration values
        if (config.restricted_role_id)
          this.roleManager.setRestrictedRoleId(config.restricted_role_id);

        if (config.admin_channel_id)
          this.notificationManager.setAdminChannelId(config.admin_channel_id);

        if (config.verification_channel_id)
          this.notificationManager.setVerificationChannelId(config.verification_channel_id);

        console.log(`Initialized configuration for guild: ${guild.name} (${guildId})`);
      } catch (error) {
        console.error(`Failed to initialize configuration for guild ${guildId}:`, error);
      }
    }

    console.log(`Initialized configurations for ${guilds.size} guilds`);
  }

  /**
   * Handle when the bot joins a new guild
   */
  private async handleGuildCreate(guild: Guild): Promise<void> {
    try {
      console.log(`Bot joined new guild: ${guild.name} (${guild.id})`);

      // Create default configuration for the new guild
      const config = await this.configService.getServerConfig(guild.id);
      console.log(`Created default configuration for guild: ${guild.name} (${guild.id})`);

      // Set up verification channel if auto_setup is enabled globally
      if (globalConfig.getSettings().autoSetupVerificationChannels) {
        const restrictedRoleId = config.restricted_role_id;
        if (restrictedRoleId) {
          const channelId = await this.notificationManager.setupVerificationChannel(
            guild,
            restrictedRoleId
          );
          if (channelId) {
            // Update the configuration with the new channel ID
            await this.configService.updateServerConfig(guild.id, {
              verification_channel_id: channelId,
            });
            console.log(`Set up verification channel for guild: ${guild.name} (${guild.id})`);
          }
        }
      }
    } catch (error) {
      console.error(`Failed to handle new guild ${guild.id}:`, error);
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
        ephemeral: true,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to configure the bot.',
        ephemeral: true,
      });
      return;
    }

    // Get the key and value from the command options
    const key = interaction.options.getString('key', true);
    const value = interaction.options.getString('value', true);

    // Validate the key
    const validKeys = [
      'restricted_role_id',
      'admin_channel_id',
      'verification_channel_id',
      'admin_notification_role_id',
    ];
    if (!validKeys.includes(key)) {
      await interaction.reply({
        content: `Invalid configuration key: ${key}. Valid keys are: ${validKeys.join(', ')}`,
        ephemeral: true,
      });
      return;
    }

    try {
      // Update the configuration in the database
      await this.configService.updateServerConfig(guild.id, {
        [key]: value,
      });

      // Update the services with the new values
      if (key === 'restricted_role_id') {
        this.roleManager.setRestrictedRoleId(value);
      } else if (key === 'admin_channel_id') {
        this.notificationManager.setAdminChannelId(value);
      } else if (key === 'verification_channel_id') {
        this.notificationManager.setVerificationChannelId(value);
      }

      // Respond to the user
      await interaction.reply({
        content: `✅ Configuration updated successfully!\n\`${key}\` has been set to \`${value}\``,
        ephemeral: true,
      });
    } catch (error) {
      console.error(`Failed to update configuration for guild ${guild.id}:`, error);
      await interaction.reply({
        content: 'An error occurred while updating the configuration. Please try again later.',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle the /listthreads command
   * @param interaction The slash command interaction
   */
  private async handleListThreadsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: 'You need Manage Messages permissions to list verification threads.',
        ephemeral: true,
      });
      return;
    }

    // Defer the reply as it might take a moment to fetch threads
    await interaction.deferReply({ ephemeral: true });

    try {
      // Get all open threads
      const threadIds = await this.notificationManager.getOpenVerificationThreads(guild.id);

      if (threadIds.length === 0) {
        await interaction.editReply({
          content: 'No open verification threads found in this server.',
        });
        return;
      }

      // Try to fetch the actual thread objects
      const threadLinks: string[] = [];

      for (const threadId of threadIds) {
        try {
          const thread = await guild.channels.fetch(threadId).catch(() => null);
          if (thread && thread.isThread()) {
            threadLinks.push(`<#${threadId}>`);
          } else {
            // Thread exists in DB but not on Discord
            threadLinks.push(`Thread ${threadId} (unavailable)`);
          }
        } catch (error) {
          console.error(`Failed to fetch thread ${threadId}:`, error);
          threadLinks.push(`Thread ${threadId} (error fetching)`);
        }
      }

      // Send a message with all thread links
      await interaction.editReply({
        content: `**Open Verification Threads (${threadLinks.length})**\n\n${threadLinks.join('\n')}`,
      });
    } catch (error) {
      console.error('Error listing threads:', error);
      await interaction.editReply({
        content: 'An error occurred while listing verification threads.',
      });
    }
  }

  /**
   * Handle the /resolvethread command
   * @param interaction The slash command interaction
   */
  private async handleResolveThreadCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    // Check if the interaction is in a guild
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true,
      });
      return;
    }

    // Check if the user has the required permissions
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        content: 'You need Manage Messages permissions to resolve verification threads.',
        ephemeral: true,
      });
      return;
    }

    // Get the thread ID and resolution
    const threadId = interaction.options.getString('threadid');
    const resolution = interaction.options.getString('resolution') as
      | 'verified'
      | 'banned'
      | 'ignored';

    if (!threadId || !resolution) {
      await interaction.reply({
        content: 'Thread ID and resolution are required.',
        ephemeral: true,
      });
      return;
    }

    // Defer the reply as it might take a moment to update
    await interaction.deferReply({ ephemeral: true });

    try {
      // Update the thread status in the database
      const success = await this.notificationManager.resolveVerificationThread(
        guild.id,
        threadId,
        resolution,
        interaction.user.id
      );

      if (success) {
        // Try to update the thread name to indicate resolution
        try {
          const thread = await guild.channels.fetch(threadId).catch(() => null);
          if (thread && thread.isThread()) {
            // Update the thread name to indicate resolution
            const newName = `[${resolution.toUpperCase()}] ${thread.name}`;
            await thread.setName(newName);

            // Send a message in the thread
            await (thread as ThreadChannel).send({
              content: `This thread has been marked as **${resolution}** by <@${interaction.user.id}>.`,
            });
          }
        } catch (error) {
          console.error(`Failed to update thread ${threadId}:`, error);
          // Continue anyway since we've already updated the database
        }

        await interaction.editReply({
          content: `✅ Thread ${threadId} has been marked as ${resolution}.`,
        });
      } else {
        await interaction.editReply({
          content: `❌ Failed to resolve thread ${threadId}. The thread may not exist or is already resolved.`,
        });
      }
    } catch (error) {
      console.error('Error resolving thread:', error);
      await interaction.editReply({
        content: 'An error occurred while resolving the verification thread.',
      });
    }
  }

  // Helper function to manage thread state
  private async manageThreadState(
    guildId: string,
    userId: string,
    shouldLock: boolean,
    shouldArchive: boolean
  ): Promise<void> {
    try {
      // Use getActiveVerification to find the relevant event
      const verificationEvent = await this.verificationService.getActiveVerification(
        guildId,
        userId
      );

      // If verifying/banning and no *active* event found, check the *most recent* resolved one
      // This handles cases where the button is clicked after the event is already technically resolved
      let eventToCheck = verificationEvent;
      if (!eventToCheck && (shouldArchive || shouldLock)) {
        const history = await this.verificationService.getVerificationHistory(
          await this.client.guilds.fetch(guildId).then((g) => g.members.fetch(userId))
        );
        if (history.length > 0) {
          eventToCheck = history[0]; // Get the most recent one from history
        }
      }

      if (!eventToCheck || !eventToCheck.thread_id) {
        console.log(
          `No suitable verification thread found for user ${userId} in guild ${guildId} to manage state.`
        );
        return;
      }

      const thread = await this.client.channels.fetch(eventToCheck.thread_id).catch(() => null);
      if (!thread || !thread.isThread()) {
        console.warn(`Could not fetch thread ${eventToCheck.thread_id} to manage state.`);
        return;
      }

      const threadChannel = thread as ThreadChannel;

      if (threadChannel.locked !== shouldLock) {
        await threadChannel.setLocked(shouldLock, `Verification status change`);
        console.log(`Set thread ${threadChannel.id} locked state to ${shouldLock}`);
      }

      // Only change archive state if necessary
      if (threadChannel.archived !== shouldArchive) {
        if (shouldArchive && !threadChannel.archived) {
          await threadChannel.setArchived(true, `Verification resolved`);
          console.log(`Archived thread ${threadChannel.id}`);
        } else if (!shouldArchive && threadChannel.archived) {
          await threadChannel.setArchived(false, `Verification reopened`);
          console.log(`Unarchived thread ${threadChannel.id}`);
        }
      }
    } catch (error) {
      console.error(`Error managing thread state for user ${userId} in guild ${guildId}:`, error);
    }
  }
}
