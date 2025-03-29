import {
  Client,
  Message,
  GuildMember,
  User,
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
import { IHeuristicService } from './services/HeuristicService';
import { IGPTService, UserProfileData } from './services/GPTService';
import { IDetectionOrchestrator } from './services/DetectionOrchestrator';
import { IRoleManager } from './services/RoleManager';
import { INotificationManager } from './services/NotificationManager';
import { IConfigService } from './config/ConfigService';
import { globalConfig } from './config/GlobalConfig';
import { IDetectionEventsRepository } from './repositories/DetectionEventsRepository';
import { IUserRepository } from './repositories/UserRepository';
import { IServerRepository } from './repositories/ServerRepository';
import { IServerMemberRepository } from './repositories/ServerMemberRepository';
import { ISecurityActionService } from './services/SecurityActionService';
import { IUserModerationService } from './services/UserModerationService';
import { TYPES } from './di/symbols';

// Load environment variables
dotenv.config();

/**
 * Interface for the Bot class
 */
export interface IBot {
  /**
   * Start the bot and connect to Discord
   */
  startBot(): Promise<void>;

  /**
   * Clean up resources and disconnect from Discord
   */
  destroy(): Promise<void>;
}

@injectable()
export class Bot implements IBot {
  private client: Client;
  private heuristicService: IHeuristicService;
  private gptService: IGPTService;
  private detectionOrchestrator: IDetectionOrchestrator;
  private roleManager: IRoleManager;
  private notificationManager: INotificationManager;
  private configService: IConfigService;
  private detectionEventsRepository: IDetectionEventsRepository;
  private userRepository: IUserRepository;
  private serverRepository: IServerRepository;
  private serverMemberRepository: IServerMemberRepository;
  private securityActionService: ISecurityActionService;
  private userModerationService: IUserModerationService;
  private commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.HeuristicService) heuristicService: IHeuristicService,
    @inject(TYPES.GPTService) gptService: IGPTService,
    @inject(TYPES.DetectionOrchestrator) detectionOrchestrator: IDetectionOrchestrator,
    @inject(TYPES.RoleManager) roleManager: IRoleManager,
    @inject(TYPES.NotificationManager) notificationManager: INotificationManager,
    @inject(TYPES.ConfigService) configService: IConfigService,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.SecurityActionService) securityActionService: ISecurityActionService,
    @inject(TYPES.UserModerationService) userModerationService: IUserModerationService
  ) {
    this.client = client;
    this.heuristicService = heuristicService;
    this.gptService = gptService;
    this.detectionOrchestrator = detectionOrchestrator;
    this.roleManager = roleManager;
    this.notificationManager = notificationManager;
    this.configService = configService;
    this.detectionEventsRepository = detectionEventsRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.securityActionService = securityActionService;
    this.userModerationService = userModerationService;

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

    // Set up event handlers
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
    this.client.on('guildCreate', this.handleGuildCreate.bind(this));
  }

  /**
   * Start the bot and connect to Discord
   */
  public async startBot(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable not set');
    }
    await this.client.login(token);
    console.log('Bot started and logged in!');
  }

  /**
   * Clean up resources and disconnect from Discord
   */
  public async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
    }
  }

  private async handleReady(): Promise<void> {
    if (!this.client.user) {
      console.error('Client user not available');
      return;
    }

    console.log(`Logged in as ${this.client.user.tag}!`);

    // Initialize services
    await this.configService.initialize();

    // Initialize servers
    await this.initializeServers();

    // Register slash commands
    await this.registerCommands();
  }

  private async registerCommands(): Promise<void> {
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
    const customId = interaction.customId;

    try {
      // Extract action and user ID from the custom ID
      const [action, userId] = customId.split('_');

      // Get the guild member
      const member = await interaction.guild?.members.fetch(userId);
      if (!member) {
        await interaction.reply({
          content: 'Could not find the user in this server.',
          ephemeral: true,
        });
        return;
      }

      // Get the message that contains the button
      const message = interaction.message;
      let thread: ThreadChannel | null = null;

      // Handle the specific button action
      switch (action) {
        case 'verify': {
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
          break;
        }

        case 'ban': {
          const success = await this.userModerationService.banUser(
            member,
            'Banned via admin panel button',
            interaction.user
          );
          if (success) {
            await interaction.reply({
              content: `🚫 User ${member.user.tag} has been banned.`,
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: `❌ Failed to ban ${member.user.tag}. Please check the bot's permissions.`,
              ephemeral: true,
            });
          }
          break;
        }

        case 'thread': {
          thread = await this.securityActionService.createVerificationThreadForMember(
            member,
            message,
            interaction.user
          );

          if (thread) {
            await interaction.reply({
              content: `✅ Created a verification thread for ${member.user.tag}.`,
              ephemeral: true,
            });
          } else {
            await interaction.reply({
              content: `❌ Failed to create a verification thread for ${member.user.tag}. Please check the bot's permissions and channel configuration.`,
              ephemeral: true,
            });
          }
          break;
        }

        case 'history': {
          await this.notificationManager.handleHistoryButtonClick(interaction, userId);
          break;
        }

        default:
          await interaction.reply({
            content: `Unknown button action: ${action}`,
            ephemeral: true,
          });
      }
    } catch (error) {
      console.error('Error handling button interaction:', error);
      await interaction.reply({
        content: 'An error occurred while processing this button.',
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
        profileData = this.extractUserProfileData(message.author, message.member);
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
      const profileData = this.extractUserProfileData(member.user, member);

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
  private extractUserProfileData(user: User, member: GuildMember): UserProfileData {
    return {
      username: user.username,
      discriminator: user.discriminator,
      nickname: member.nickname || undefined,
      accountCreatedAt: new Date(user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
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
            ...this.extractUserProfileData(message.author, message.member),
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
              `Reason: ${newAccountResult.reasons.join(', ')}\n` +
              `Used GPT: ${newAccountResult.usedGPT}`
          );
          break;

        case 'spamwords':
          // Test with known spam keywords
          spamMessage = 'free discord nitro gift card claim your prize now';
          spamResult = await this.detectionOrchestrator.detectMessage(
            message.guild?.id || 'TEST',
            message.author.id,
            spamMessage,
            this.extractUserProfileData(message.author, message.member)
          );

          await message.reply(
            `Test message: "${spamMessage}"\n` +
              `Result: ${spamResult.label}\n` +
              `Confidence: ${(spamResult.confidence * 100).toFixed(2)}%\n` +
              `Reason: ${spamResult.reasons.join(', ')}\n` +
              `Used GPT: ${spamResult.usedGPT}`
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
}
