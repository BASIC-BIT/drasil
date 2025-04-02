import { Client } from 'discord.js';
import * as dotenv from 'dotenv';
import { injectable, inject } from 'inversify';
import { TYPES } from './di/symbols';
import 'reflect-metadata';
import { IEventHandler } from './controllers/EventHandler';

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
  private eventHandler: IEventHandler;

  constructor(
    @inject(TYPES.DiscordClient) client: Client,
    @inject(TYPES.EventHandler) eventHandler: IEventHandler
  ) {
    this.client = client;
    this.eventHandler = eventHandler;
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

    await this.eventHandler.setupEventHandlers();
  }

  /**
   * Clean up resources and disconnect from Discord
   */
  public async destroy(): Promise<void> {
    await this.client.destroy();
  }
}
