import {
  Client,
  GatewayIntentBits,
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
} from 'discord.js';
import * as dotenv from 'dotenv';
import { HeuristicService } from './services/HeuristicService';
import { GPTService, UserProfileData } from './services/GPTService';
import { DetectionOrchestrator } from './services/DetectionOrchestrator';
import { RoleManager } from './services/RoleManager';
import { NotificationManager } from './services/NotificationManager';

// Load environment variables
dotenv.config();

export class Bot {
  private client: Client;
  private heuristicService: HeuristicService;
  private gptService: GPTService;
  private detectionOrchestrator: DetectionOrchestrator;
  private roleManager: RoleManager;
  private notificationManager: NotificationManager;
  private commands: RESTPostAPIChatInputApplicationCommandsJSONBody[];

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
      ],
    });

    // Initialize services
    this.heuristicService = new HeuristicService();
    this.gptService = new GPTService();
    this.detectionOrchestrator = new DetectionOrchestrator(this.heuristicService, this.gptService);
    this.roleManager = new RoleManager();
    this.notificationManager = new NotificationManager(this.client);

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
    ].map((command) => command.toJSON());

    // Set up event handlers
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
    this.client.on('interactionCreate', this.handleInteraction.bind(this));
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

  private handleReady(): void {
    console.log('Bot is ready!');
    this.registerCommands();
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

      default:
        await interaction.reply({
          content: `Unknown command: ${commandName}`,
          ephemeral: true,
        });
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const customId = interaction.customId;

    // Parse the button ID format: action_userId
    const [action, userId] = customId.split('_');

    if (!userId) {
      await interaction.reply({
        content: 'Invalid button ID format',
        ephemeral: true,
      });
      return;
    }

    try {
      // Fetch the target user from the server
      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({
          content: 'This command can only be used in a server',
          ephemeral: true,
        });
        return;
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.reply({
          content: `Could not find user with ID ${userId} in this server.`,
          ephemeral: true,
        });
        return;
      }

      // Get the original message to update with action log
      const message = interaction.message;

      // Handle the specific button action
      switch (action) {
        case 'verify':
          await this.verifyUser(member, interaction);
          // Log the action to the original message
          await this.notificationManager.logActionToMessage(
            message,
            'verified the user',
            interaction.user
          );
          break;

        case 'ban':
          await this.banUser(member, 'Banned via admin panel button', interaction);
          // Log the action to the original message
          await this.notificationManager.logActionToMessage(
            message,
            'banned the user',
            interaction.user
          );
          break;

        case 'thread':
          await this.createVerificationThread(member, interaction);
          // Log the action to the original message
          await this.notificationManager.logActionToMessage(
            message,
            'created a verification thread',
            interaction.user
          );
          break;

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
    await this.verifyUser(member, interaction);
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
    await this.banUser(member, reason, interaction);
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

  private async verifyUser(
    member: GuildMember,
    interaction: ChatInputCommandInteraction | ButtonInteraction
  ): Promise<void> {
    // Remove the restricted role
    const success = await this.roleManager.removeRestrictedRole(member);

    if (success) {
      await interaction.reply({
        content: `✅ User ${member.user.tag} has been verified and the restricted role has been removed.`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Failed to remove restricted role from ${member.user.tag}. Please check the bot's permissions and role configuration.`,
        ephemeral: true,
      });
    }
  }

  private async banUser(
    member: GuildMember,
    reason: string,
    interaction: ChatInputCommandInteraction | ButtonInteraction
  ): Promise<void> {
    try {
      await member.ban({ reason });
      await interaction.reply({
        content: `🚫 User ${member.user.tag} has been banned. Reason: ${reason}`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('Failed to ban user:', error);
      await interaction.reply({
        content: `❌ Failed to ban ${member.user.tag}. Please check the bot's permissions.`,
        ephemeral: true,
      });
    }
  }

  private async createVerificationThread(
    member: GuildMember,
    interaction: ChatInputCommandInteraction | ButtonInteraction
  ): Promise<void> {
    const success = await this.notificationManager.createVerificationThread(member);

    if (success) {
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
        userId,
        content,
        profileData
      );

      // If suspicious, take action
      if (detectionResult.label === 'SUSPICIOUS') {
        console.log(`User flagged for spam: ${message.author.tag} (${userId})`);
        console.log(`Message content: ${content}`);
        console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
        console.log(`Reasons: ${detectionResult.reasons.join(', ')}`);
        console.log(`Trigger source: ${detectionResult.triggerSource}`);

        // Assign restricted role if user is in a guild
        if (message.member) {
          const restrictSuccess = await this.roleManager.assignRestrictedRole(message.member);
          if (restrictSuccess) {
            console.log(`Assigned restricted role to ${message.author.tag}`);
          } else {
            console.log(`Failed to assign restricted role to ${message.author.tag}`);
          }

          // Send notification to admin channel
          const notifySuccess = await this.notificationManager.notifySuspiciousUser(
            message.member,
            detectionResult
          );
          if (notifySuccess) {
            console.log(`Sent notification to admin channel about ${message.author.tag}`);
          } else {
            console.log(`Failed to send notification to admin channel about ${message.author.tag}`);
          }
        }
      }
    } catch (error) {
      console.error('Error detecting spam:', error);
    }
  }

  private async handleGuildMemberAdd(member: GuildMember): Promise<void> {
    try {
      console.log(`New member joined: ${member.user.tag} (${member.id})`);

      // Extract profile data
      const profileData = this.extractUserProfileData(member.user, member);

      // Run detection on new join
      const detectionResult = await this.detectionOrchestrator.detectNewJoin(profileData);

      // If suspicious, take action
      if (detectionResult.label === 'SUSPICIOUS') {
        console.log(`New member flagged as suspicious: ${member.user.tag} (${member.id})`);
        console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
        console.log(`Reasons: ${detectionResult.reasons.join(', ')}`);
        console.log(`Trigger source: ${detectionResult.triggerSource}`);

        // Assign restricted role
        const restrictSuccess = await this.roleManager.assignRestrictedRole(member);
        if (restrictSuccess) {
          console.log(`Assigned restricted role to ${member.user.tag}`);
        } else {
          console.log(`Failed to assign restricted role to ${member.user.tag}`);
        }

        // Send notification to admin channel
        const notifySuccess = await this.notificationManager.notifySuspiciousUser(
          member,
          detectionResult
        );
        if (notifySuccess) {
          console.log(`Sent notification to admin channel about ${member.user.tag}`);
        } else {
          console.log(`Failed to send notification to admin channel about ${member.user.tag}`);
        }
      }
    } catch (error) {
      console.error('Error processing new member:', error);
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
            ...this.extractUserProfileData(message.author, message.member as GuildMember),
            accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old account
            joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
          };

          // Analyze with this profile
          newAccountResult = await this.detectionOrchestrator.detectMessage(
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
            message.author.id,
            spamMessage,
            this.extractUserProfileData(message.author, message.member as GuildMember)
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
}
