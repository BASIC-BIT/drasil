import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { TYPES } from './di/symbols';
import type { IBot } from './Bot';
import { initPhoenixTracing } from './observability/phoenix';
import type { IProductAnalyticsService } from './services/ProductAnalyticsService';

// Load environment variables
dotenv.config();

/**
 * Application bootstrap function
 */
async function bootstrap(): Promise<void> {
  try {
    console.log('Starting Anti-Spam Bot...');

    const tracingInitResult = initPhoenixTracing();
    if (
      !tracingInitResult.enabled &&
      tracingInitResult.reason !== 'PHOENIX_TRACING_ENABLED not set'
    ) {
      console.warn(`[phoenix] tracing disabled: ${tracingInitResult.reason}`);
    }

    // Create and configure the container
    const { configureContainer } = await import('./di/container');
    const container = configureContainer();

    // Get the bot instance from the container
    const bot = container.get<IBot>(TYPES.Bot);
    const productAnalyticsService = container.get<IProductAnalyticsService>(
      TYPES.ProductAnalyticsService
    );

    // Start the bot
    await bot.startBot();

    console.log('Bot initialized and running!');

    // Handle graceful shutdown
    setupGracefulShutdown(bot, productAnalyticsService);
  } catch (error) {
    console.error('Error starting bot:', error);
    process.exit(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 * @param bot The bot instance
 */
function setupGracefulShutdown(bot: IBot, productAnalyticsService: IProductAnalyticsService): void {
  // Handle graceful shutdown on SIGINT and SIGTERM
  process.on('SIGINT', async () => {
    console.log('Received SIGINT signal. Shutting down gracefully...');
    await shutdown(bot, productAnalyticsService);
  });

  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM signal. Shutting down gracefully...');
    await shutdown(bot, productAnalyticsService);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', async (error) => {
    console.error('Uncaught exception:', error);
    await shutdown(bot, productAnalyticsService);
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', async (reason) => {
    console.error('Unhandled promise rejection:', reason);
    await shutdown(bot, productAnalyticsService);
  });
}

/**
 * Clean shutdown procedure
 * @param bot The bot instance
 */
async function shutdown(
  bot: IBot,
  productAnalyticsService: IProductAnalyticsService
): Promise<void> {
  try {
    console.log('Cleaning up resources...');
    await bot.destroy();
    await productAnalyticsService.shutdown();
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
