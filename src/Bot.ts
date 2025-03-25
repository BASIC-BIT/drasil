import { Client, GatewayIntentBits, Message } from 'discord.js';
import * as dotenv from 'dotenv';
import { HeuristicService } from './services/HeuristicService';

// Load environment variables
dotenv.config();

export class Bot {
  private client: Client;
  private heuristicService: HeuristicService;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

    // Initialize services
    this.heuristicService = new HeuristicService();

    // Set up event handlers
    this.client.on('ready', this.handleReady.bind(this));
    this.client.on('messageCreate', this.handleMessage.bind(this));
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
    }

    // Check for spam using heuristic service
    const userId = message.author.id;
    const content = message.content;

    if (this.heuristicService.isMessageSuspicious(userId, content)) {
      console.log(`User flagged for spam: ${message.author.tag} (${userId})`);
      console.log(`Message content: ${content}`);
    }
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
