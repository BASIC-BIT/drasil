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
   */
  private extractUserProfileData(user: User, member: GuildMember): UserProfileData {
    return {
      username: user.username,
      discriminator: user.discriminator,
      nickname: member.nickname || undefined,
      bio: '', // Not available through API without additional requests
      accountCreatedAt: new Date(user.createdTimestamp),
      joinedServerAt: member.joinedAt ? new Date(member.joinedAt) : new Date(),
      connectedAccounts: [], // Would need additional API access
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
}
