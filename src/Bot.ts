import { Client, GatewayIntentBits, Message, GuildMember, User } from 'discord.js';
import * as dotenv from 'dotenv';
import { HeuristicService } from './services/HeuristicService';
import { GPTService, UserProfileData } from './services/GPTService';
import { DetectionOrchestrator } from './services/DetectionOrchestrator';

// Load environment variables
dotenv.config();

export class Bot {
  private client: Client;
  private heuristicService: HeuristicService;
  private gptService: GPTService;
  private detectionOrchestrator: DetectionOrchestrator;

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

    // Set up event handlers
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
    this.client.on('guildMemberAdd', this.handleGuildMemberAdd.bind(this));
  }

  private handleReady(): void {
    console.log('Bot is ready!');
  }

  private async handleMessage(message: Message): Promise<void> {
    // Ignore messages from bots (including self)
    if (message.author.bot) return;

    // Handle ping command
    if (message.content === '!ping') {
      await message.reply('Pong!');
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

      // If suspicious, log it for now
      if (detectionResult.label === 'SUSPICIOUS') {
        console.log(`User flagged for spam: ${message.author.tag} (${userId})`);
        console.log(`Message content: ${content}`);
        console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
        console.log(`Reason: ${detectionResult.reason}`);
        console.log(`Used GPT: ${detectionResult.usedGPT}`);
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

      // If suspicious, log it for now
      if (detectionResult.label === 'SUSPICIOUS') {
        console.log(`New member flagged as suspicious: ${member.user.tag} (${member.id})`);
        console.log(`Detection confidence: ${(detectionResult.confidence * 100).toFixed(2)}%`);
        console.log(`Reason: ${detectionResult.reason}`);
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

  public async startBot(): Promise<void> {
    const token = process.env.DISCORD_TOKEN;
    if (!token) {
      throw new Error('DISCORD_TOKEN is not set in environment variables');
    }

    try {
      await this.client.login(token);
    } catch (error) {
      console.error('Failed to start bot:', error);
      throw error;
    }
  }

  // Method to help with testing - allows us to destroy the client
  public async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
    }
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
              `Reason: ${newAccountResult.reason}\n` +
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
              `Reason: ${spamResult.reason}\n` +
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
