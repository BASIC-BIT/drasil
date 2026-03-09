import { Collection } from 'discord.js';
import {
  InMemoryDetectionEventsRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';
import { VerificationThreadAnalysisService } from '../../services/VerificationThreadAnalysisService';
import { DetectionType, VerificationStatus } from '../../repositories/types';

describe('VerificationThreadAnalysisService (unit)', () => {
  const buildMessage = (overrides: Partial<any> = {}) => {
    const messages = new Collection<string, any>();
    const base = {
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      content: 'I joined for the weekly speedrun races.',
      author: {
        id: 'user-1',
        username: 'runner',
      },
      channel: {
        isThread: () => true,
        messages: {
          fetch: jest.fn().mockResolvedValue(messages),
        },
      },
      ...overrides,
    };

    return { message: base, messages };
  };

  it('does nothing when thread analysis is disabled', async () => {
    const verificationRepo = new InMemoryVerificationEventRepository();
    const detectionRepo = new InMemoryDetectionEventsRepository();
    const detectionEvent = await detectionRepo.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Suspicious content'],
    });
    const verificationEvent = await verificationRepo.createFromDetection(
      detectionEvent.id,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationRepo.update(verificationEvent.id, {
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn(),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn(),
    } as any;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          verification_ai_thread_analysis_enabled: false,
          verification_ai_thread_analysis_message_limit: 3,
        },
      }),
    } as any;
    const service = new VerificationThreadAnalysisService(
      configService,
      gptService,
      notificationManager,
      verificationRepo,
      detectionRepo
    );

    const { message } = buildMessage();
    const handled = await service.handleThreadMessage(message as any);

    expect(handled).toBe(true);
    expect(gptService.analyzeVerificationThreadResponses).not.toHaveBeenCalled();
  });

  it('consumes admin replies in verification threads without running AI analysis', async () => {
    const verificationRepo = new InMemoryVerificationEventRepository();
    const detectionRepo = new InMemoryDetectionEventsRepository();
    const verificationEvent = await verificationRepo.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationRepo.update(verificationEvent.id, {
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn(),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn(),
    } as any;
    const configService = {
      getServerConfig: jest.fn(),
    } as any;
    const service = new VerificationThreadAnalysisService(
      configService,
      gptService,
      notificationManager,
      verificationRepo,
      detectionRepo
    );

    const { message } = buildMessage({
      author: {
        id: 'admin-1',
        username: 'moderator',
      },
    });
    const handled = await service.handleThreadMessage(message as any);

    expect(handled).toBe(true);
    expect(configService.getServerConfig).not.toHaveBeenCalled();
    expect(gptService.analyzeVerificationThreadResponses).not.toHaveBeenCalled();
    expect(notificationManager.updateVerificationThreadAnalysis).not.toHaveBeenCalled();
  });

  it('analyzes flagged-user verification replies and updates the admin notification', async () => {
    const verificationRepo = new InMemoryVerificationEventRepository();
    const detectionRepo = new InMemoryDetectionEventsRepository();
    const detectionEvent = await detectionRepo.create({
      server_id: 'guild-1',
      user_id: 'user-1',
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.8,
      reasons: ['Recent suspicious activity'],
    });
    const verificationEvent = await verificationRepo.createFromDetection(
      detectionEvent.id,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationRepo.update(verificationEvent.id, {
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn().mockResolvedValue({
        result: 'OK',
        confidence: 0.67,
        summary: 'Looks like a real user answering normally.',
      }),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
    } as any;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          verification_ai_thread_analysis_enabled: true,
          verification_ai_thread_analysis_message_limit: 3,
        },
      }),
    } as any;
    const service = new VerificationThreadAnalysisService(
      configService,
      gptService,
      notificationManager,
      verificationRepo,
      detectionRepo
    );

    const { message, messages } = buildMessage();
    messages.set('msg-0', {
      id: 'msg-0',
      author: { id: 'user-1' },
      content: 'Hi, I found the server from the Doom Discord.',
      createdTimestamp: 1,
    });
    messages.set('msg-1', {
      id: 'msg-1',
      author: { id: 'user-1' },
      content: 'I joined for the weekly speedrun races.',
      createdTimestamp: 2,
    });

    const handled = await service.handleThreadMessage(message as any);

    expect(handled).toBe(true);
    expect(gptService.analyzeVerificationThreadResponses).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 'guild-1',
        userId: 'user-1',
        messages: [
          'Hi, I found the server from the Doom Discord.',
          'I joined for the weekly speedrun races.',
        ],
        detectionReasons: ['Recent suspicious activity'],
      })
    );
    expect(notificationManager.updateVerificationThreadAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      expect.objectContaining({ result: 'OK' }),
      1
    );

    const updated = await verificationRepo.findById(verificationEvent.id);
    expect(updated?.metadata).toEqual({
      thread_analysis: {
        analyzedMessageIds: ['msg-1'],
      },
    });
  });

  it('stops analyzing once the configured message limit is reached', async () => {
    const verificationRepo = new InMemoryVerificationEventRepository();
    const detectionRepo = new InMemoryDetectionEventsRepository();
    const verificationEvent = await verificationRepo.createFromDetection(
      null,
      'guild-1',
      'user-1',
      VerificationStatus.PENDING
    );
    await verificationRepo.update(verificationEvent.id, {
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
      metadata: {
        thread_analysis: {
          analyzedMessageIds: ['msg-0', 'msg-1'],
        },
      },
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn(),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn(),
    } as any;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          verification_ai_thread_analysis_enabled: true,
          verification_ai_thread_analysis_message_limit: 2,
        },
      }),
    } as any;
    const service = new VerificationThreadAnalysisService(
      configService,
      gptService,
      notificationManager,
      verificationRepo,
      detectionRepo
    );

    const { message } = buildMessage({ id: 'msg-2' });
    const handled = await service.handleThreadMessage(message as any);

    expect(handled).toBe(true);
    expect(gptService.analyzeVerificationThreadResponses).not.toHaveBeenCalled();
    expect(notificationManager.updateVerificationThreadAnalysis).not.toHaveBeenCalled();
  });
});
