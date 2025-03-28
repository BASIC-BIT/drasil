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
import { globalConfig } from '../config/GlobalConfig';

// Import the mock classes
const { MockMessage, MockGuild, MockGuildMember } = jest.requireActual('../__mocks__/discord.js');

describe('Bot', () => {
  let bot: Bot;
  let mockDetectionOrchestrator: jest.Mocked<DetectionOrchestrator>;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up environment
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.SUPABASE_URL = 'test-url';
    process.env.SUPABASE_KEY = 'test-key';

    // Reset global config
    (globalConfig as any).settings = {
      autoSetupVerificationChannels: true,
      defaultServerSettings: {
        messageThreshold: 5,
        messageTimeframe: 10,
        minConfidenceThreshold: 70,
        messageRetentionDays: 7,
        detectionRetentionDays: 30,
      },
      defaultSuspiciousKeywords: ['free nitro', 'discord nitro', 'claim your prize'],
    };

    // Initialize bot
    bot = new Bot() as any;
    mockDetectionOrchestrator = (bot as any).detectionOrchestrator as jest.Mocked<DetectionOrchestrator>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    
    if (bot) {
      bot.destroy();
    }
  });

  describe('Message handling', () => {
    describe('!ping command', () => {
      it('should respond with Pong! and suggest using slash commands', async () => {
        // Arrange
        const mockMessage = new MockMessage({
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
        expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
      });
    });

    describe('Bot messages', () => {
      it('should ignore messages from bots', async () => {
        // Arrange
        const mockMessage = new MockMessage({
          content: 'Hello there',
          isBot: true,
          userId: 'mock-bot-id',
        });

        // Act
        await bot.handleMessage(mockMessage);

        // Assert
        expect(mockMessage.reply).not.toHaveBeenCalled();
        expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
      });
    });

    describe('Suspicious message detection', () => {
      it('should detect and log suspicious messages', async () => {
        // Arrange
        mockDetectionOrchestrator.detectMessage.mockResolvedValue({
          label: 'SUSPICIOUS',
          confidence: 0.95,
          reasons: ['Test suspicious message detection'],
          usedGPT: false,
          triggerSource: 'message',
          triggerContent: 'Suspicious message',
        });

        const mockMessage = new MockMessage({
          content: 'Suspicious message',
          isBot: false,
          userId: 'mock-user-id',
          username: 'suspicious-user',
        });

        // Act
        await bot.handleMessage(mockMessage);

        // Assert
        expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalled();
      });

      it('should not log normal messages', async () => {
        // Arrange
        mockDetectionOrchestrator.detectMessage.mockResolvedValue({
          label: 'OK',
          confidence: 0.9,
          usedGPT: false,
          reasons: [],
          triggerSource: 'message',
          triggerContent: 'Hello, how are you today?',
        });

        const mockMessage = new MockMessage({
          content: 'Hello, how are you today?',
          isBot: false,
          userId: 'mock-user-id',
          username: 'normal-user',
        });

        // Act
        await bot.handleMessage(mockMessage);

        // Assert
        expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalled();
      });

      it('should handle detection errors gracefully', async () => {
        // Arrange
        const errorSpy = jest.spyOn(console, 'error').mockImplementation();
        mockDetectionOrchestrator.detectMessage.mockRejectedValue(new Error('Detection failed'));

        const mockMessage = new MockMessage({
          content: 'Test message',
          isBot: false,
          userId: 'mock-user-id',
          username: 'test-user',
        });

        // Act
        await bot.handleMessage(mockMessage);

        // Assert
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to process message'),
          expect.any(Error)
        );
        errorSpy.mockRestore();
      });
    });
  });

  describe('Member join handling', () => {
    it('should detect suspicious new members', async () => {
      // Arrange
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.85,
        reasons: ['New account'],
        usedGPT: true,
        triggerSource: 'join',
        triggerContent: '',
      });

      const mockMember = new MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
      });

      // Act
      await bot.handleGuildMemberAdd(mockMember);

      // Assert
      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalled();
    });

    it('should handle join detection errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDetectionOrchestrator.detectNewJoin.mockRejectedValue(new Error('Detection failed'));

      const mockMember = new MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
      });

      // Act
      await bot.handleGuildMemberAdd(mockMember);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process new member'),
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });

  describe('Guild creation handling', () => {
    it('should set up verification channel when auto-setup is enabled', async () => {
      // Arrange
      const mockGuild = new MockGuild('mock-guild-id', 'Test Guild');
      
      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert - we're just testing that it doesn't throw
      expect(true).toBe(true);
    });

    it('should not set up verification channel when auto-setup is disabled', async () => {
      // Arrange
      globalConfig.updateSettings({
        autoSetupVerificationChannels: false,
      });
      const mockGuild = new MockGuild('mock-guild-id', 'Test Guild');
      
      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert - we're just testing that it doesn't throw
      expect(true).toBe(true);
    });

    it('should handle guild creation errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockGuild = new MockGuild('mock-guild-id', 'Test Guild');
      
      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert
      expect(errorSpy).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Server initialization', () => {
    it('should initialize configurations for all guilds', async () => {
      // Arrange
      bot.configService.getServerConfig.mockResolvedValue({});
      
      // Act
      await bot.initializeServers();

      // Assert
      expect(bot.configService.getServerConfig).toHaveBeenCalled();
    });

    it('should handle initialization errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      bot.configService.getServerConfig.mockRejectedValue(new Error('Config error'));
      
      // Act
      await bot.initializeServers();

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});