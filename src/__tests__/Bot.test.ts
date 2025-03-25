import { Bot } from '../Bot';
import { DetectionOrchestrator } from '../services/DetectionOrchestrator';
import { Message, GuildMember } from 'discord.js';

// Mock external dependencies
jest.mock('discord.js');
jest.mock('../services/HeuristicService');
jest.mock('../services/GPTService');
jest.mock('../services/DetectionOrchestrator');

describe('Bot', () => {
  let bot: Bot;
  let mockDetectionOrchestrator: jest.Mocked<DetectionOrchestrator>;

  // Capture console logs for testing
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Spy on console.log
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

    // Create bot instance (which will create mocked services)
    bot = new Bot();

    // Get mocked DetectionOrchestrator instance from Bot
    mockDetectionOrchestrator = (bot as any)
      .detectionOrchestrator as jest.Mocked<DetectionOrchestrator>;
  });

  afterEach(() => {
    // Restore console.log after each test
    consoleLogSpy.mockRestore();

    // Clean up bot
    bot.destroy();
  });

  describe('Message handling', () => {
    it('should respond to !ping command with Pong!', async () => {
      // Mock Message object
      const mockMessage = {
        content: '!ping',
        author: { bot: false },
        reply: jest.fn().mockResolvedValue(undefined),
      } as unknown as Message;

      // Call the message handler
      await (bot as any).handleMessage(mockMessage);

      // Verify message was replied to
      expect(mockMessage.reply).toHaveBeenCalledWith('Pong!');

      // Verify DetectionOrchestrator was not called
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should ignore messages from bots', async () => {
      // Mock Message from a bot
      const mockMessage = {
        content: 'Hello there',
        author: { bot: true },
        reply: jest.fn(),
      } as unknown as Message;

      // Call the message handler
      await (bot as any).handleMessage(mockMessage);

      // Verify reply was not called
      expect(mockMessage.reply).not.toHaveBeenCalled();

      // Verify DetectionOrchestrator was not called
      expect(mockDetectionOrchestrator.detectMessage).not.toHaveBeenCalled();
    });

    it('should detect suspicious messages and log them', async () => {
      // Mock message data
      const userId = '123456789';
      const content = 'Free nitro gift for everyone!';
      const userTag = 'SuspiciousUser#1234';

      // Mock message with member for profile data
      const mockMessage = {
        content,
        author: {
          bot: false,
          id: userId,
          tag: userTag,
          username: 'SuspiciousUser',
          discriminator: '1234',
          createdTimestamp: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days old account
        },
        member: {
          nickname: null,
          joinedAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // Joined 5 days ago
        },
        reply: jest.fn(),
      } as unknown as Message;

      // Mock DetectionOrchestrator to return SUSPICIOUS
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.85,
        usedGPT: true,
        reason: 'Contains suspicious keywords',
      });

      // Call the message handler
      await (bot as any).handleMessage(mockMessage);

      // Verify DetectionOrchestrator was called with correct parameters
      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalledWith(
        userId,
        content,
        expect.objectContaining({
          username: 'SuspiciousUser',
          discriminator: '1234',
        })
      );

      // Verify suspicious message was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('User flagged for spam'));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(content));
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('85.00%')); // Confidence with formatted decimal
    });

    it('should not log normal messages', async () => {
      // Mock normal message
      const mockMessage = {
        content: 'Hello, how are you today?',
        author: {
          bot: false,
          id: '123456789',
          tag: 'NormalUser#1234',
          username: 'NormalUser',
          discriminator: '1234',
          createdTimestamp: Date.now() - 365 * 24 * 60 * 60 * 1000, // 1 year old account
        },
        member: {
          nickname: 'Nick',
          joinedAt: Date.now() - 180 * 24 * 60 * 60 * 1000, // Joined 180 days ago
        },
        reply: jest.fn(),
      } as unknown as Message;

      // Mock DetectionOrchestrator to return OK
      mockDetectionOrchestrator.detectMessage.mockResolvedValue({
        label: 'OK',
        confidence: 0.9,
        usedGPT: false,
        reason: '',
      });

      // Call the message handler
      await (bot as any).handleMessage(mockMessage);

      // Verify DetectionOrchestrator was called
      expect(mockDetectionOrchestrator.detectMessage).toHaveBeenCalled();

      // Verify no spam logging occurred
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('User flagged for spam')
      );
    });
  });

  describe('Member join handling', () => {
    it('should detect suspicious new members', async () => {
      // Create mock GuildMember
      const mockMember = {
        id: '987654321',
        user: {
          tag: 'NewUser#5678',
          username: 'NewUser',
          discriminator: '5678',
          createdTimestamp: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 day old account
        },
        nickname: null,
        joinedAt: Date.now(), // Just joined
      } as unknown as GuildMember;

      // Mock DetectionOrchestrator to return SUSPICIOUS
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'SUSPICIOUS',
        confidence: 0.75,
        usedGPT: true,
        reason: 'New account, recently created',
      });

      // Call the member join handler
      await (bot as any).handleGuildMemberAdd(mockMember);

      // Verify detectNewJoin was called with profile data
      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'NewUser',
          discriminator: '5678',
        })
      );

      // Verify suspicious join was logged
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('New member flagged as suspicious')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('75.00%')); // Confidence with formatted decimal
    });

    it('should not flag legitimate new members', async () => {
      // Create mock GuildMember for legitimate user
      const mockMember = {
        id: '555666777',
        user: {
          tag: 'LegitUser#9999',
          username: 'LegitUser',
          discriminator: '9999',
          createdTimestamp: Date.now() - 500 * 24 * 60 * 60 * 1000, // 500 days old account
        },
        nickname: 'The Legit One',
        joinedAt: Date.now(), // Just joined
      } as unknown as GuildMember;

      // Mock DetectionOrchestrator to return OK
      mockDetectionOrchestrator.detectNewJoin.mockResolvedValue({
        label: 'OK',
        confidence: 0.8,
        usedGPT: true,
        reason: 'Established account',
      });

      // Call the member join handler
      await (bot as any).handleGuildMemberAdd(mockMember);

      // Verify detectNewJoin was called
      expect(mockDetectionOrchestrator.detectNewJoin).toHaveBeenCalled();

      // Verify no suspicious flags were logged
      expect(consoleLogSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('flagged as suspicious')
      );
    });
  });
});
