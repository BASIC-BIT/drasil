import { Bot } from '../Bot';

// Mock discord.js
jest.mock('discord.js');

// Mock index.ts to prevent it from running
jest.mock('../index.ts', () => {}, { virtual: true });

describe('Bot', () => {
  let bot: Bot;
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    process.env.DISCORD_TOKEN = 'test-token';

    // Create new bot instance for each test
    bot = new Bot();
  });

  afterEach(async () => {
    if (bot) {
      await bot.destroy();
    }
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('should start successfully with valid token', async () => {
    await expect(bot.startBot()).resolves.not.toThrow();
    // Since we can't access the mock directly, we could add more assertions
    // if we need to check specific behavior
  });

  it('should throw error when token is not set', async () => {
    delete process.env.DISCORD_TOKEN;
    await expect(bot.startBot()).rejects.toThrow(
      'DISCORD_TOKEN is not set in environment variables'
    );
  });
});
