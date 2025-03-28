import 'reflect-metadata';
import { Container } from 'inversify';
import { createServiceTestContainer, createMocks } from './utils/test-container';
import { TYPES } from '../di/symbols';
import { Bot, IBot } from '../Bot';
import { DetectionResult } from '../services/DetectionOrchestrator';

// Import the Discord.js mocks
const { MockMessage, MockGuildMember } = require('../__mocks__/discord.js');

describe('Bot with InversifyJS', () => {
  let container: Container;
  let bot: IBot;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    // Create a container with real Bot implementation but mock dependencies
    container = createServiceTestContainer(TYPES.Bot, Bot);

    // Get the mocks for assertions
    mocks = createMocks();

    // Get the bot from the container
    bot = container.get<IBot>(TYPES.Bot);
  });

  afterEach(() => {
    jest.clearAllMocks();

    // Clean up resources
    if (bot) {
      bot.destroy();
    }
  });

  describe('startBot', () => {
    beforeEach(() => {
      process.env.DISCORD_TOKEN = 'test-token';
    });

    it('should login with Discord client', async () => {
      // Act
      await bot.startBot();

      // Assert
      expect(mocks.mockDiscordClient.login).toHaveBeenCalledWith('test-token');
    });

    it('should throw error when DISCORD_TOKEN is not set', async () => {
      // Arrange
      delete process.env.DISCORD_TOKEN;

      // Act & Assert
      await expect(bot.startBot()).rejects.toThrow('DISCORD_TOKEN environment variable not set');
    });
  });

  describe('Message handling', () => {
    it('should respond to ping command', async () => {
      // Arrange
      const mockMessage = MockMessage({
        content: '!ping',
        isBot: false,
        userId: 'mock-user-id',
        guildId: 'mock-guild-id',
      });

      // Get the Bot instance directly for private method access
      const botInstance = container.get<Bot>(TYPES.Bot);

      // Act
      await botInstance['handleMessage'](mockMessage);

      // Assert
      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Pong! Note: Please use slash commands instead (e.g. /ping)'
      );
      expect(mocks.mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should ignore messages from bots', async () => {
      // Arrange
      const mockMessage = MockMessage({
        content: 'Hello there',
        isBot: true,
        userId: 'mock-bot-id',
        guildId: 'mock-guild-id',
      });

      // Get the Bot instance directly for private method access
      const botInstance = container.get<Bot>(TYPES.Bot);

      // Act
      await botInstance['handleMessage'](mockMessage);

      // Assert
      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mocks.mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should detect suspicious messages and take action', async () => {
      // Arrange
      const suspiciousResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 0.95,
        reasons: ['Test suspicious message detection'],
        usedGPT: false,
        triggerSource: 'message',
        triggerContent: 'Suspicious message',
      };

      mocks.mockDetectionOrchestrator.detectMessage.mockResolvedValue(suspiciousResult);

      const mockMessage = MockMessage({
        content: 'Suspicious message',
        isBot: false,
        userId: 'mock-user-id',
        username: 'suspicious-user',
        guildId: 'mock-guild-id',
      });

      // Override the container's mock with our custom mock
      container.unbind(TYPES.DetectionOrchestrator);
      container.bind(TYPES.DetectionOrchestrator).toConstantValue(mocks.mockDetectionOrchestrator);

      // Get the Bot instance directly for private method access
      const botInstance = container.get<Bot>(TYPES.Bot);

      // Act
      await botInstance['handleMessage'](mockMessage);

      // Assert
      expect(mocks.mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        'mock-guild-id',
        'mock-user-id',
        'Suspicious message',
        expect.any(Object)
      );

      // Check if restricted role was assigned
      expect(mocks.mockRoleManager.assignRestrictedRole).toHaveBeenCalled();

      // Check if notification was sent
      expect(mocks.mockNotificationManager.notifySuspiciousUser).toHaveBeenCalledWith(
        expect.any(Object), // member
        suspiciousResult,
        mockMessage // source message
      );
    });
  });

  describe('GuildMember join handling', () => {
    it('should detect suspicious new members and take action', async () => {
      // Arrange
      const suspiciousResult: DetectionResult = {
        label: 'SUSPICIOUS',
        confidence: 0.85,
        reasons: ['New account'],
        usedGPT: true,
        triggerSource: 'join',
        triggerContent: '',
      };

      mocks.mockDetectionOrchestrator.detectNewJoin.mockResolvedValue(suspiciousResult);

      const mockMember = MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
        guildId: 'mock-guild-id',
      });

      // Override the container's mock with our custom mock
      container.unbind(TYPES.DetectionOrchestrator);
      container.bind(TYPES.DetectionOrchestrator).toConstantValue(mocks.mockDetectionOrchestrator);

      // Get the Bot instance directly for private method access
      const botInstance = container.get<Bot>(TYPES.Bot);

      // Act
      await botInstance['handleGuildMemberAdd'](mockMember);

      // Assert
      expect(mocks.mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
        'mock-guild-id',
        'mock-user-id',
        expect.any(Object)
      );

      // Check if restricted role was assigned
      expect(mocks.mockRoleManager.assignRestrictedRole).toHaveBeenCalledWith(mockMember);

      // Check if notification was sent
      expect(mocks.mockNotificationManager.notifySuspiciousUser).toHaveBeenCalledWith(
        mockMember,
        suspiciousResult
      );

      // Verify a thread was created
      expect(mocks.mockNotificationManager.createVerificationThread).toHaveBeenCalledWith(
        mockMember
      );
    });

    it('should not take action for safe new members', async () => {
      // Arrange
      const safeResult: DetectionResult = {
        label: 'OK',
        confidence: 0.95,
        reasons: [],
        usedGPT: true,
        triggerSource: 'join',
        triggerContent: '',
      };

      mocks.mockDetectionOrchestrator.detectNewJoin.mockResolvedValue(safeResult);

      const mockMember = MockGuildMember({
        id: 'mock-user-id',
        username: 'TestUser',
        guildId: 'mock-guild-id',
      });

      // Override the container's mock with our custom mock
      container.unbind(TYPES.DetectionOrchestrator);
      container.bind(TYPES.DetectionOrchestrator).toConstantValue(mocks.mockDetectionOrchestrator);

      // Get the Bot instance directly for private method access
      const botInstance = container.get<Bot>(TYPES.Bot);

      // Act
      await botInstance['handleGuildMemberAdd'](mockMember);

      // Assert
      expect(mocks.mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalled();

      // Verify no actions were taken
      expect(mocks.mockRoleManager.assignRestrictedRole).not.toHaveBeenCalled();
      expect(mocks.mockNotificationManager.notifySuspiciousUser).not.toHaveBeenCalled();
      expect(mocks.mockNotificationManager.createVerificationThread).not.toHaveBeenCalled();
    });
  });

  // You can add more test cases for other Bot functionality
  // such as command handling, interaction handling, etc.
});
