import { GuildMember, Message } from 'discord.js';
import { EventHandler } from '../../controllers/EventHandler';
import { DetectionType } from '../../repositories/types';

describe('EventHandler (unit)', () => {
  function buildHandler(overrides?: {
    detectionOrchestrator?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
  }): EventHandler {
    const detectionOrchestrator = overrides?.detectionOrchestrator ?? {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'hello',
      }),
      detectNewJoin: jest.fn(),
    };

    const configService = overrides?.configService ?? {
      initialize: jest.fn().mockResolvedValue(undefined),
      getCachedServerConfig: jest.fn().mockReturnValue({}),
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          detection_response_mode: 'notify_only',
          min_confidence_threshold: 70,
        },
      }),
    };

    return new EventHandler(
      { on: jest.fn() } as any,
      detectionOrchestrator as any,
      {
        upsertObservedDetectionNotification: jest.fn(),
        setupVerificationChannel: jest.fn(),
      } as any,
      configService as any,
      { handleSuspiciousMessage: jest.fn(), openCaseForSuspiciousMessage: jest.fn() } as any,
      { handleTestCommands: jest.fn(), registerCommands: jest.fn() } as any,
      { handleButtonInteraction: jest.fn(), handleModalSubmit: jest.fn() } as any,
      { handleThreadMessage: jest.fn().mockResolvedValue(false) } as any
    );
  }

  function buildMessage(hasModerationPermission: boolean): Message {
    const member = {
      id: 'user-1',
      nickname: null,
      joinedAt: new Date('2024-01-01T00:00:00.000Z'),
      guild: { id: 'guild-1' },
      user: {
        id: 'user-1',
        username: 'test-user',
        discriminator: '0001',
        createdTimestamp: new Date('2020-01-01T00:00:00.000Z').getTime(),
      },
      permissions: {
        has: jest.fn().mockReturnValue(hasModerationPermission),
      },
    } as unknown as GuildMember;

    return {
      author: { bot: false, id: 'user-1' },
      content: 'free nitro',
      guild: { id: 'guild-1' },
      member,
      channel: { isThread: jest.fn().mockReturnValue(false) },
    } as unknown as Message;
  }

  it('skips automatic message detection for moderation members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn(),
      detectNewJoin: jest.fn(),
    };
    const configService = {
      initialize: jest.fn(),
      getCachedServerConfig: jest.fn(),
      getServerConfig: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator, configService });

    await (handler as any).handleMessage(buildMessage(true));

    expect(configService.initialize).not.toHaveBeenCalled();
    expect(detectionOrchestrator.detectMessage).not.toHaveBeenCalled();
  });

  it('runs automatic message detection for regular members', async () => {
    const detectionOrchestrator = {
      detectMessage: jest.fn().mockResolvedValue({
        label: 'OK',
        confidence: 0,
        reasons: [],
        triggerSource: DetectionType.SUSPICIOUS_CONTENT,
        triggerContent: 'free nitro',
      }),
      detectNewJoin: jest.fn(),
    };
    const handler = buildHandler({ detectionOrchestrator });

    await (handler as any).handleMessage(buildMessage(false));

    expect(detectionOrchestrator.detectMessage).toHaveBeenCalledWith(
      'guild-1',
      'user-1',
      'free nitro',
      expect.objectContaining({
        serverId: 'guild-1',
        userId: 'user-1',
        username: 'test-user',
      })
    );
  });
});
