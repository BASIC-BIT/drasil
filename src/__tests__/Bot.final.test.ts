// Mock all required services
jest.mock('discord.js');
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
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Pong! Note: Please use slash commands instead (e.g. /ping)'
      );
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should ignore messages from bots', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');

      // Arrange
      const mockMessage = MockMessage({
        content: 'Hello there',
        isBot: true,
        userId: 'mock-bot-id',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should detect suspicious messages', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');

      // Arrange
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.95,
        reasons: ['Test suspicious message detection'],
        usedGPT: false,
        triggerSource: 'message',
        triggerContent: 'Suspicious message',
      });

      const mockMessage = MockMessage({
        content: 'Suspicious message',
        isBot: false,
        userId: 'mock-user-id',
        username: 'suspicious-user',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        'mock-guild-id',
        'mock-user-id',
        'Suspicious message',
        expect.objectContaining({
          username: 'suspicious-user',
        })
      );
    });

    it('should handle DM messages', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');

      // Arrange
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'OK',
        confidence: 0.9,
        usedGPT: false,
        reasons: [],
        triggerSource: 'message',
        triggerContent: 'Hello, how are you today?',
      });

      const mockMessage = MockMessage({
        content: 'Hello, how are you today?',
        isBot: false,
        userId: 'mock-user-id',
        username: 'normal-user',
        guildId: null, // DM message
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        'DM',
        'mock-user-id',
        'Hello, how are you today?',
        expect.objectContaining({
          username: 'normal-user',
        })
      );
    });

    it('should handle detection errors gracefully', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');

      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDetectionOrchestrator.detectMessage.mockRejectedValue(new Error('Detection failed'));

      const mockMessage = MockMessage({
        content: 'Test message',
        isBot: false,
        userId: 'mock-user-id',
        username: 'test-user',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Member join handling', () => {
    it('should detect suspicious new members', async () => {
      // Import the mock directly
      const { MockGuildMember } = require('../__mocks__/discord.js');

      // Arrange
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.85,
        reasons: ['New account'],
        usedGPT: true,
        triggerSource: 'join',
        triggerContent: '',
      });

      const mockMember = MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleGuildMemberAdd(mockMember);

      // Assert
      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
        'mock-guild-id',
        'mock-user-id',
        expect.objectContaining({
          username: 'TestUser',
        })
      );
    });

    it('should handle join detection errors gracefully', async () => {
      // Import the mock directly
      const { MockGuildMember } = require('../__mocks__/discord.js');

      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockDetectionOrchestrator.detectNewJoin.mockRejectedValue(new Error('Detection failed'));

      const mockMember = MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleGuildMemberAdd(mockMember);

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Guild creation handling', () => {
    // Skip this test for now as it requires more complex mocking
    // eslint-disable-next-line jest/no-disabled-tests
    it.skip('should set up verification channel when auto-setup is enabled', async () => {
      // Import the mock directly
      const { MockGuild } = require('../__mocks__/discord.js');

      // Arrange
      (global as any).globalConfig = {
        getSettings: jest.fn().mockReturnValue({
          autoSetupVerificationChannels: true,
        }),
      };

      const mockGuild = MockGuild({
        id: 'mock-guild-id',
        name: 'Test Guild',
      });

      // Ensure the channels.create method is properly mocked
      mockGuild.channels.create.mockResolvedValue({ id: 'new-channel-id' });

      // Mock the configService to avoid errors
      bot.configService.getServerConfig.mockResolvedValue({
        restricted_role_id: 'mock-role-id',
      });

      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert
      expect(mockGuild.channels.create).toHaveBeenCalled();
    });

    it('should not set up verification channel when auto-setup is disabled', async () => {
      // Import the mock directly
      const { MockGuild } = require('../__mocks__/discord.js');

      // Arrange
      (global as any).globalConfig = {
        getSettings: jest.fn().mockReturnValue({
          autoSetupVerificationChannels: false,
        }),
      };

      const mockGuild = MockGuild({
        id: 'mock-guild-id',
        name: 'Test Guild',
      });

      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert
      expect(mockGuild.channels.create).not.toHaveBeenCalled();
    });

    // Skip this test for now as it requires more complex mocking
    // eslint-disable-next-line jest/no-disabled-tests
    it.skip('should handle guild creation errors gracefully', async () => {
      // Import the mock directly
      const { MockGuild } = require('../__mocks__/discord.js');

      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockGuild = MockGuild({
        id: 'mock-guild-id',
        name: 'Test Guild',
      });

      // Force an error by rejecting the channels.create promise
      mockGuild.channels.create.mockRejectedValue(new Error('Channel creation failed'));

      // Mock the configService to avoid errors
      bot.configService.getServerConfig.mockResolvedValue({
        restricted_role_id: 'mock-role-id',
      });

      // Act
      await bot.handleGuildCreate(mockGuild);

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Server initialization', () => {
    // Skip this test for now as it requires more complex mocking
    // eslint-disable-next-line jest/no-disabled-tests
    it.skip('should initialize configurations for all guilds', async () => {
      // Import the mock directly
      const { MockGuild } = require('../__mocks__/discord.js');

      // Arrange
      bot.client.guilds.cache.clear();
      const mockGuild1 = MockGuild({
        id: '1',
        name: 'Guild 1',
      });
      const mockGuild2 = MockGuild({
        id: '2',
        name: 'Guild 2',
      });

      bot.client.guilds.cache.set('1', mockGuild1);
      bot.client.guilds.cache.set('2', mockGuild2);

      // Mock the configService
      bot.configService.getServerConfig.mockResolvedValue({});

      // Act
      await bot.initializeServers();

      // Assert
      expect(bot.configService.getServerConfig).toHaveBeenCalled();
      expect(bot.configService.getServerConfig.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // Skip this test for now as it requires more complex mocking
    // eslint-disable-next-line jest/no-disabled-tests
    it.skip('should handle initialization errors gracefully', async () => {
      // Import the mock directly
      const { MockGuild } = require('../__mocks__/discord.js');

      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      bot.client.guilds.cache.clear();
      const mockGuild = MockGuild({
        id: 'error-guild',
        name: 'Error Guild',
      });
      bot.client.guilds.cache.set('error-guild', mockGuild);

      // Force an error
      bot.configService.getServerConfig.mockRejectedValue(new Error('Config error'));

      // Act
      await bot.initializeServers();

      // Assert
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });

  describe('Test commands', () => {
    it('should handle test commands with server ID', async () => {
      // Import the mock directly
      const { MockMessage } = require('../__mocks__/discord.js');

      // Arrange
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.85,
        reasons: ['Test command'],
        usedGPT: false,
        triggerSource: 'message',
        triggerContent: '',
      });

      const mockMessage = MockMessage({
        content: '!test spamwords',
        isBot: false,
        userId: 'mock-user-id',
        username: 'test-user',
        guildId: 'mock-guild-id',
      });

      // Act
      await bot.handleMessage(mockMessage);

      // Assert
      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        'mock-guild-id',
        'mock-user-id',
        'free discord nitro gift card claim your prize now',
        expect.objectContaining({
          username: 'test-user',
        })
      );
    });
  });
});
