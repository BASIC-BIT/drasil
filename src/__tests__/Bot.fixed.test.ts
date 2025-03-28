// Mock all required services
jest.mock('discord.js');
jest.mock('../Bot');
jest.mock('../config/supabase');
jest.mock('../services/DetectionOrchestrator');
jest.mock('../services/HeuristicService');
jest.mock('../services/GPTService');
jest.mock('../services/RoleManager');
jest.mock('../services/NotificationManager');
jest.mock('../config/ConfigService');

import { Bot } from '../Bot';

describe('Bot', () => {
  let bot: any;
  let mockDetectionOrchestrator: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.SUPABASE_URL = 'test-url';
    process.env.SUPABASE_KEY = 'test-key';

    // Initialize bot
    bot = new Bot();
    mockDetectionOrchestrator = bot.detectionOrchestrator;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    
    if (bot) {
      bot.destroy();
    }
  });

  describe('Message handling', () => {
    it('should respond to !ping command', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');
      
      // Arrange
      const mockMessage = MockMessage({
        content: '!ping',
        isBot: false,
        userId: 'mock-user-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Pong! Note: Please use slash commands instead (e.g. /ping)'
      );
    });

  });
});