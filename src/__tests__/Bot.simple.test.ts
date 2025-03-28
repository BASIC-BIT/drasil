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
import { DetectionOrchestrator } from '../services/DetectionOrchestrator';

// Import the mock classes
const { MockMessage, MockGuild, MockGuildMember } = jest.requireActual('../__mocks__/discord.js');

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
    mockDetectionOrchestrator = (bot as any).detectionOrchestrator;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    
    if (bot) {
      bot.destroy();
    }
  });

  describe('Message handling', () => {
    it('should respond to !ping command', async () => {
      // Arrange
      const mockMessage = MockMessage({
        content: '!ping',
        isBot: false,
        userId: 'mock-user-id',
      });

      // Act
      await (bot as any).handleMessage(mockMessage);

      // Assert
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Pong! Note: Please use slash commands instead (e.g. /ping)'
      );
    });

    it('should ignore messages from bots', async () => {
      // Arrange
      const mockMessage = MockMessage({
        content: 'Hello there',
        isBot: true,
        userId: 'mock-bot-id',
      });

      // Act
      await (bot as any).handleMessage(mockMessage);

      // Assert
      expect(mockMessage.reply).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDetectionOrchestrator.detectMessage.mockRejectedValue(new Error('Test error'));

      const mockMessage = MockMessage({
        content: 'Test message',
        isBot: false,
        userId: 'mock-user-id',
      });

      // Debug
      console.log('Mock Message:', mockMessage);

      // Act
      await (bot as any).handleMessage(mockMessage);

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});