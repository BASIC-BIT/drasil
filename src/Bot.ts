import { Client, GatewayIntentBits, Message } from 'discord.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

export class Bot {
  private client: Client;

  constructor() {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });

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
