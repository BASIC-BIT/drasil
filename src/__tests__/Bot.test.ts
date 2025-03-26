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

jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  SlashCommandBuilder: MockSlashCommandBuilder,
  Client: MockClient,
}));
jest.mock('../services/DetectionOrchestrator');

describe('Bot', () => {
  let bot: Bot;
  let mockDetectionOrchestrator: jest.Mocked<DetectionOrchestrator>;
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
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
        reason: 'Test suspicious message detection',
        usedGPT: false,
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
        reason: '',
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
        reason: 'New account, recently created',
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
        reason: 'Established account',
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
});
