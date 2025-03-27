// Mock classes
class MockSlashCommandBuilder {
  setName() {
    return this;
  }
  setDescription() {
    return this;
  }
  addUserOption() {
    return this;
  }
  addStringOption() {
    return this;
  }
  toJSON() {
    return {};
  }

  constructor() {
    return this;
  }
}

class MockClient {
  on() {}
  async login() {}
  async destroy() {}
}

import { Bot } from '../Bot';
import { DetectionOrchestrator } from '../services/DetectionOrchestrator';
import { Message, GuildMember } from 'discord.js';
import { globalConfig } from '../config/GlobalConfig';
import { Client, Guild } from 'discord.js';

jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  SlashCommandBuilder: MockSlashCommandBuilder,
  Client: MockClient,
}));
jest.mock('../services/DetectionOrchestrator');

// Mock services
jest.mock('../services/HeuristicService');
jest.mock('../services/GPTService');
jest.mock('../services/RoleManager');
jest.mock('../services/NotificationManager');
jest.mock('../config/ConfigService');

describe('Bot', () => {
  let bot: Bot;
  let mockDetectionOrchestrator: jest.Mocked<DetectionOrchestrator>;
  let consoleLogSpy: jest.SpyInstance;
  let mockClient: jest.Mocked<Client>;
  let mockGuild: jest.Mocked<Guild>;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    process.env.DISCORD_TOKEN = 'test-token';

    // Reset global config to default settings
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

    // Create mock guild
    mockGuild = {
      id: '123456789',
      name: 'Test Guild',
    } as unknown as jest.Mocked<Guild>;

    // Create mock client
    mockClient = {
      login: jest.fn().mockResolvedValue('token'),
      destroy: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<Client>;

    (Client as jest.MockedClass<typeof Client>).mockImplementation(() => mockClient);

    bot = new Bot();
    mockDetectionOrchestrator = (bot as any).detectionOrchestrator;
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    if (bot) {
      bot.destroy();
    }
  });

  describe('Message handling', () => {
    it('should respond to !ping command with Pong!', async () => {
      const mockMessage = {
        content: '!ping',
        author: { bot: false },
        reply: jest.fn().mockResolvedValue(undefined),
      } as unknown as Message;

      await (bot as any).handleMessage(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith(
        'Pong! Note: Please use slash commands instead (e.g. /ping)'
      );
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should ignore messages from bots', async () => {
      const mockMessage = {
        content: 'Hello there',
        author: { bot: true },
        reply: jest.fn(),
      } as unknown as Message;

      await (bot as any).handleMessage(mockMessage);

      expect(mockMessage.reply).not.toHaveBeenCalled();
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should detect suspicious messages and log them', async () => {
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.95,
        reasons: ['Test suspicious message detection'],
        usedGPT: false,
        triggerSource: 'message',
        triggerContent: 'Suspicious message',
      });

      const mockMessage = {
        content: 'Suspicious message',
        author: {
          bot: false,
          id: 'mock-user-id',
          tag: 'mock-user#1234',
          username: 'mock-user',
        },
        member: {
          roles: {
            cache: new Map(),
            add: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
          },
        },
        reply: jest.fn().mockResolvedValue(undefined),
      } as unknown as Message;

      await (bot as any).handleMessage(mockMessage);

      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        'mock-user-id',
        'Suspicious message',
        expect.objectContaining({
          username: 'mock-user',
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('User flagged for spam'));
    });

    it('should not log normal messages', async () => {
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'OK',
        confidence: 0.9,
        usedGPT: false,
        reasons: [],
        triggerSource: 'message',
        triggerContent: 'Hello, how are you today?',
      });

      const mockMessage = {
        content: 'Hello, how are you today?',
        author: {
          bot: false,
          id: '123456789',
          username: 'NormalUser',
        },
        reply: jest.fn(),
      } as unknown as Message;

      await (bot as any).handleMessage(mockMessage);

      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('User flagged for spam')
      );
    });
  });

  describe('Member join handling', () => {
    it('should detect suspicious new members', async () => {
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.75,
        usedGPT: true,
        reasons: ['New account, recently created'],
        triggerSource: 'join',
      });

      const mockMember = {
        id: '987654321',
        user: {
          username: 'NewUser',
          discriminator: '5678',
        },
      } as unknown as GuildMember;

      await (bot as any).handleGuildMemberAdd(mockMember);

      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'NewUser',
          discriminator: '5678',
        })
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('New member flagged as suspicious')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('75.00%'));
    });

    it('should not flag legitimate new members', async () => {
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'OK',
        confidence: 0.8,
        usedGPT: true,
        reasons: ['Established account'],
        triggerSource: 'join',
      });

      const mockMember = {
        id: '555666777',
        user: {
          username: 'LegitUser',
          discriminator: '9999',
        },
      } as unknown as GuildMember;

      await (bot as any).handleGuildMemberAdd(mockMember);

      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('flagged as suspicious')
      );
    });
  });

  describe('handleGuildCreate', () => {
    it('should set up verification channel when auto-setup is enabled', async () => {
      // Set up mock guild with necessary methods
      const mockGuildWithMethods = {
        ...mockGuild,
        channels: {
          create: jest.fn().mockResolvedValue({ id: 'new-channel-id' }),
        },
      } as unknown as jest.Mocked<Guild>;

      // Call the private method using type assertion
      await (bot as any).handleGuildCreate(mockGuildWithMethods);

      // Verify that the verification channel setup was attempted
      expect(mockGuildWithMethods.channels.create).toHaveBeenCalled();
    });

    it('should not set up verification channel when auto-setup is disabled', async () => {
      // Disable auto-setup in global config
      globalConfig.updateSettings({
        autoSetupVerificationChannels: false,
      });

      // Set up mock guild with necessary methods
      const mockGuildWithMethods = {
        ...mockGuild,
        channels: {
          create: jest.fn().mockResolvedValue({ id: 'new-channel-id' }),
        },
      } as unknown as jest.Mocked<Guild>;

      // Call the private method using type assertion
      await (bot as any).handleGuildCreate(mockGuildWithMethods);

      // Verify that the verification channel setup was not attempted
      expect(mockGuildWithMethods.channels.create).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      // Mock console.error to track error logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Set up mock guild that throws an error
      const mockGuildWithError = {
        ...mockGuild,
        channels: {
          create: jest.fn().mockRejectedValue(new Error('Test error')),
        },
      } as unknown as jest.Mocked<Guild>;

      // Call the private method using type assertion
      await (bot as any).handleGuildCreate(mockGuildWithError);

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to handle new guild'),
        expect.any(Error)
      );

      // Clean up
      consoleSpy.mockRestore();
    });
  });

  describe('initializeServers', () => {
    it('should initialize configurations for all guilds', async () => {
      // Set up mock guilds cache
      const mockGuilds = new Map([
        ['1', { id: '1', name: 'Guild 1' }],
        ['2', { id: '2', name: 'Guild 2' }],
      ]);

      mockClient.guilds = {
        cache: mockGuilds,
      } as any;

      // Call the private method using type assertion
      await (bot as any).initializeServers();

      // Verify that configurations were initialized for both guilds
      // This will depend on your ConfigService mock implementation
      // You might want to verify that getServerConfig was called for each guild
    });

    it('should handle errors during initialization', async () => {
      // Mock console.error to track error logging
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Set up mock guilds cache with a guild that will cause an error
      const mockGuilds = new Map([['error-guild', { id: 'error-guild', name: 'Error Guild' }]]);

      mockClient.guilds = {
        cache: mockGuilds,
      } as any;

      // Make ConfigService throw an error for this guild
      const mockConfigService = (bot as any).configService;
      mockConfigService.getServerConfig.mockRejectedValueOnce(new Error('Test error'));

      // Call the private method using type assertion
      await (bot as any).initializeServers();

      // Verify error was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize configuration for guild'),
        expect.any(Error)
      );

      // Clean up
      consoleSpy.mockRestore();
    });
  });
});
