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
import { Guild } from 'discord.js';
import { globalConfig } from '../config/GlobalConfig';

// Import the mock classes directly
const discordMocks = jest.requireActual('../__mocks__/discord.js');
const { MockClient, MockMessage, MockGuild, MockGuildMember } = discordMocks;

// Original bot tests, kept for posterity

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('Bot', () => {
  let bot: Bot;
  let mockDetectionOrchestrator: jest.Mocked<DetectionOrchestrator>;
  // let consoleLogSpy: jest.SpyInstance;
  let mockClient: any;

  beforeEach(() => {
    // Clear all mocks and restore console
    // jest.clearAllMocks();
    // consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

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

    // Create mock client
    mockClient = new MockClient();

    // Use the mocked Client from jest.mock('discord.js')
    // The mock is already set up in the discord.js mock file

    // Initialize bot
    bot = new Bot();
    mockDetectionOrchestrator = (bot as any).detectionOrchestrator;
  });

  afterEach(() => {
    // consoleLogSpy.mockRestore();
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
        await (bot as any).handleMessage(mockMessage);

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
        await (bot as any).handleMessage(mockMessage);

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
        await (bot as any).handleMessage(mockMessage);

        // Assert
        expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
          'mock-user-id',
          'Suspicious message',
          expect.objectContaining({
            username: 'suspicious-user',
          })
        );
        // expect(consoleLogSpy).toHaveBeenCalledWith(
        //   expect.stringContaining('User flagged for spam')
        // );
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
        await (bot as any).handleMessage(mockMessage);

        // Assert
        expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalled();
        // expect(consoleLogSpy).not.toHaveBeenCalledWith(
        //   expect.stringContaining('User flagged for spam')
        // );
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
        await (bot as any).handleMessage(mockMessage);

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
      await (bot as any).handleGuildMemberAdd(mockMember);

      // Assert
      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
        'mock-user-id',
        expect.objectContaining({
          username: 'TestUser',
        })
      );
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
      await (bot as any).handleGuildMemberAdd(mockMember);

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
      jest.spyOn(mockGuild.channels, 'create').mockResolvedValue({ id: 'new-channel-id' } as any);

      // Act
      await (bot as any).handleGuildCreate(mockGuild);

      // Assert
      expect(mockGuild.channels.create).toHaveBeenCalled();
    });

    it('should not set up verification channel when auto-setup is disabled', async () => {
      // Arrange
      globalConfig.updateSettings({
        autoSetupVerificationChannels: false,
      });
      const mockGuild = new MockGuild('mock-guild-id', 'Test Guild');
      jest.spyOn(mockGuild.channels, 'create');

      // Act
      await (bot as any).handleGuildCreate(mockGuild);

      // Assert
      expect(mockGuild.channels.create).not.toHaveBeenCalled();
    });

    it('should handle guild creation errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      const mockGuild = new MockGuild('mock-guild-id', 'Test Guild');
      jest
        .spyOn(mockGuild.channels, 'create')
        .mockRejectedValue(new Error('Channel creation failed'));

      // Act
      await (bot as any).handleGuildCreate(mockGuild);

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to handle new guild'),
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });

  describe('Server initialization', () => {
    it('should initialize configurations for all guilds', async () => {
      // Arrange
      mockClient.guilds.cache.clear();
      const mockGuild1 = new MockGuild('1', 'Guild 1');
      const mockGuild2 = new MockGuild('2', 'Guild 2');

      mockClient.guilds.cache.set('1', mockGuild1 as unknown as Guild);
      mockClient.guilds.cache.set('2', mockGuild2 as unknown as Guild);

      // Act
      await (bot as any).initializeServers();

      // Assert
      expect((bot as any).configService.getServerConfig).toHaveBeenCalledTimes(2);
    });

    it('should handle initialization errors gracefully', async () => {
      // Arrange
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();
      mockClient.guilds.cache.clear();
      const mockGuild = new MockGuild('error-guild', 'Error Guild');
      mockClient.guilds.cache.set('error-guild', mockGuild as unknown as Guild);
      (bot as any).configService.getServerConfig.mockRejectedValueOnce(new Error('Config error'));

      // Act
      await (bot as any).initializeServers();

      // Assert
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize configuration for guild'),
        expect.any(Error)
      );
      errorSpy.mockRestore();
    });
  });
});
