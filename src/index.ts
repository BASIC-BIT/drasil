import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { configureContainer } from './di/container';
import { TYPES } from './di/symbols';
import { IBot } from './Bot';

// Load environment variables
dotenv.config();

/**
 * Application bootstrap function
 */
async function bootstrap(): Promise<void> {
  try {
    console.log('Starting Anti-Spam Bot...');

    // Create and configure the container
    const container = configureContainer();


    // Explicitly get singleton subscribers to ensure they are instantiated and subscribe early
    container.get(TYPES.RestrictionSubscriber);
    container.get(TYPES.NotificationSubscriber);
    container.get(TYPES.RoleUpdateSubscriber);
    container.get(TYPES.ActionLogSubscriber);
    container.get(TYPES.ServerMemberStatusSubscriber);
    container.get(TYPES.VerificationReopenSubscriber);
    container.get(TYPES.DetectionResultHandlerSubscriber);

    // Get the bot instance from the container
    const bot = container.get<IBot>(TYPES.Bot);

    // Start the bot
    await bot.startBot();

    console.log('Bot initialized and running!');

    // Handle graceful shutdown
    setupGracefulShutdown(bot);
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 * @param bot The bot instance
 */
function setupGracefulShutdown(bot: IBot): void {
  // Handle graceful shutdown on SIGINT and SIGTERM
  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal. Shutting down gracefully...');
    await shutdown(bot);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal. Shutting down gracefully...');
    await shutdown(bot);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await shutdown(bot);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled promise rejection:', reason);
    await shutdown(bot);
  });
}

/**
 * Clean shutdown procedure
 * @param bot The bot instance
 */
async function shutdown(bot: IBot): Promise<void> {
  try {
    console.log('Cleaning up resources...');
    await bot.destroy();
    console.log('Bot disconnected and resources released.');

    // Exit with success code
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);

    // Exit with error code
    process.exit(1);
  }
}

// Start the application
bootstrap().catch((error) => {
  console.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
