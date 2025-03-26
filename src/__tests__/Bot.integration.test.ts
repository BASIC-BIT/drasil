import { RoleManager } from '../services/RoleManager';
import { NotificationManager } from '../services/NotificationManager';

// Mock all dependencies directly
jest.mock('../services/RoleManager');
jest.mock('../services/NotificationManager');
jest.mock('../services/HeuristicService');
jest.mock('../services/GPTService');
jest.mock('../services/DetectionOrchestrator');

// Import the discord.js mock - already set up via Jest's module mock system
jest.mock('discord.js');

// Import Bot class after mocks are setup
import { Bot } from '../Bot';

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('Bot Tests', () => {
  // Set environment variables
  process.env.DISCORD_TOKEN = 'mock-token';
  process.env.RESTRICTED_ROLE_ID = 'mock-role-id';
  process.env.ADMIN_CHANNEL_ID = 'mock-channel-id';

  let bot: Bot;

  beforeEach(() => {
    jest.clearAllMocks();
    bot = new Bot();
  });

  afterEach(async () => {
    await bot.destroy();
  });

  it('should initialize the bot and all services successfully', () => {
    expect(bot).toBeDefined();
    expect(RoleManager).toHaveBeenCalled();
    expect(NotificationManager).toHaveBeenCalled();
  });

  it('should start the bot with token', async () => {
    // Get the client instance
    const clientInstance = (bot as any).client;

    // Start the bot
    await bot.startBot();

    // Verify login was called with correct token
    expect(clientInstance.login).toHaveBeenCalledWith('mock-token');
  });
});
