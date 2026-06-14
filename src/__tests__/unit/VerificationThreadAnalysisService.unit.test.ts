import { Collection } from 'discord.js';
import {
  InMemoryDetectionEventsRepository,
  InMemoryVerificationEventRepository,
} from '../fakes/inMemoryRepositories';
import { VerificationThreadAnalysisService } from '../../services/VerificationThreadAnalysisService';
import { DetectionType, VerificationStatus } from '../../repositories/types';

describe('VerificationThreadAnalysisService (unit)', () => {
  const messageCreatedTimestamp = Date.parse('2026-06-03T12:00:00.000Z');

  const buildMessage = (overrides: Partial<any> = {}) => {
    const messages = new Collection<string, any>();
    const base = {
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      content: 'I joined for the weekly speedrun races.',
      createdTimestamp: messageCreatedTimestamp,
      author: {
        id: 'user-1',
        username: 'runner',
      },
      attachments: new Collection<string, any>(),
      url: 'https://discord.com/channels/guild-1/thread-1/msg-1',
      channel: {
        name: 'Verification: runner',
        isThread: () => true,
        messages: {
          fetch: jest.fn().mockResolvedValue(messages),
        },
      },
      ...overrides,
    };

    return { message: base, messages };
  };

  it('mirrors support-check replies before skipping disabled thread analysis', async () => {
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
      private_evidence_thread_id: 'evidence-thread-1',
      notification_message_id: 'notif-1',
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn(),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn(),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(false),
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
    expect(
      notificationManager.mirrorVerificationThreadMessageToEvidenceThread
    ).toHaveBeenCalledWith(expect.objectContaining({ id: verificationEvent.id }), message);
    expect(gptService.analyzeVerificationThreadResponses).not.toHaveBeenCalled();
  });

  it('does not rewrite support reminder response metadata after the first target reply', async () => {
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
      private_evidence_thread_id: 'evidence-thread-1',
      metadata: {
        support_thread_reminder: {
          lastReminderAt: '2026-06-02T12:00:00.000Z',
          reminderCount: 1,
          userRespondedAt: '2026-06-03T12:00:00.000Z',
        },
      },
    });

    const gptService = {
      analyzeVerificationThreadResponses: jest.fn(),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn(),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(false),
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
    const updateSpy = jest.spyOn(verificationRepo, 'update');

    const { message } = buildMessage({ id: 'msg-2' });
    const handled = await service.handleThreadMessage(message as any);

    expect(handled).toBe(true);
    expect(
      notificationManager.mirrorVerificationThreadMessageToEvidenceThread
    ).toHaveBeenCalledWith(expect.objectContaining({ id: verificationEvent.id }), message);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(gptService.analyzeVerificationThreadResponses).not.toHaveBeenCalled();
  });

  it('ignores non-verification threads before hitting the repository', async () => {
    const verificationRepo = {
      findByThreadId: jest.fn(),
    } as any;
    const service = new VerificationThreadAnalysisService(
      { getServerConfig: jest.fn() } as any,
      { analyzeVerificationThreadResponses: jest.fn() } as any,
      {
        updateVerificationThreadAnalysis: jest.fn(),
        mirrorVerificationThreadMessageToEvidenceThread: jest.fn(),
      } as any,
      verificationRepo,
      { findById: jest.fn() } as any
    );

    const { message } = buildMessage({
      channel: {
        name: 'Off-topic chat',
        isThread: () => true,
        messages: { fetch: jest.fn() },
      },
    });

    await expect(service.handleThreadMessage(message as any)).resolves.toBe(false);
    expect(verificationRepo.findByThreadId).not.toHaveBeenCalled();
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
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn(),
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
    expect(
      notificationManager.mirrorVerificationThreadMessageToEvidenceThread
    ).not.toHaveBeenCalled();
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
        result: 'likely_legitimate',
        confidence: 0.67,
        summary: 'Looks like a real user answering normally.',
        reasonCodes: ['server_context_match'],
        legitimacySignals: ['Mentions weekly speedrun races'],
        suspicionSignals: [],
        recommendedNextQuestion: 'Which category do you run?',
        recommendedAction: 'ask_followup',
        model: 'gpt-4o-mini',
        promptVersion: 'verification-thread-legitimacy-v2',
        isFallback: false,
      }),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
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
      expect.objectContaining({ result: 'likely_legitimate', recommendedAction: 'ask_followup' }),
      2
    );
    expect(
      notificationManager.mirrorVerificationThreadMessageToEvidenceThread
    ).toHaveBeenCalledWith(expect.objectContaining({ id: verificationEvent.id }), message);

    const updated = await verificationRepo.findById(verificationEvent.id);
    expect(updated?.metadata).toEqual({
      support_thread_reminder: {
        reminderCount: 0,
        userRespondedAt: '2026-06-03T12:00:00.000Z',
      },
      thread_analysis: {
        analyzedMessageIds: ['msg-1'],
        latestAnalysis: {
          result: 'likely_legitimate',
          confidence: 0.67,
          summary: 'Looks like a real user answering normally.',
          reasonCodes: ['server_context_match'],
          legitimacySignals: ['Mentions weekly speedrun races'],
          suspicionSignals: [],
          recommendedNextQuestion: 'Which category do you run?',
          recommendedAction: 'ask_followup',
          analyzedMessageCount: 2,
        },
      },
    });
  });

  it('downgrades verification restrict recommendations when max action is hints', async () => {
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
        result: 'likely_suspicious',
        confidence: 0.99,
        summary: 'Responses look evasive.',
        reasonCodes: ['evasive_reply'],
        legitimacySignals: [],
        suspicionSignals: ['Does not answer server-specific prompt'],
        recommendedAction: 'restrict',
        model: 'gpt-4o-mini',
        promptVersion: 'verification-thread-legitimacy-v2',
        isFallback: false,
      }),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
    } as any;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          verification_ai_thread_analysis_enabled: true,
          verification_ai_thread_analysis_message_limit: 3,
          verification_ai_max_action: 'hints',
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
    messages.set('msg-1', {
      id: 'msg-1',
      author: { id: 'user-1' },
      content: 'why do you need to know',
      createdTimestamp: 2,
    });

    await expect(service.handleThreadMessage(message as any)).resolves.toBe(true);
    expect(notificationManager.updateVerificationThreadAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      expect.objectContaining({ recommendedAction: 'manual_review' }),
      1
    );

    const updated = await verificationRepo.findById(verificationEvent.id);
    expect(updated?.metadata).toMatchObject({
      thread_analysis: {
        latestAnalysis: {
          recommendedAction: 'manual_review',
        },
      },
    });
  });

  it.each([
    {
      name: 'confidence is below the restrict threshold',
      result: 'likely_suspicious',
      confidence: 0.94,
    },
    {
      name: 'result is not suspicious',
      result: 'likely_legitimate',
      confidence: 0.99,
    },
  ])('downgrades verification restrict recommendations when $name', async (analysisCase) => {
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
        result: analysisCase.result,
        confidence: analysisCase.confidence,
        summary: 'Responses need review.',
        reasonCodes: ['reply_review_needed'],
        legitimacySignals: [],
        suspicionSignals: ['Does not answer server-specific prompt'],
        recommendedAction: 'restrict',
        model: 'gpt-4o-mini',
        promptVersion: 'verification-thread-legitimacy-v2',
        isFallback: false,
      }),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
    } as any;
    const configService = {
      getServerConfig: jest.fn().mockResolvedValue({
        settings: {
          verification_ai_thread_analysis_enabled: true,
          verification_ai_thread_analysis_message_limit: 3,
          verification_ai_max_action: 'restrict',
          verification_ai_restrict_threshold: 0.95,
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
    messages.set('msg-1', {
      id: 'msg-1',
      author: { id: 'user-1' },
      content: 'why do you need to know',
      createdTimestamp: 2,
    });

    await expect(service.handleThreadMessage(message as any)).resolves.toBe(true);
    expect(notificationManager.updateVerificationThreadAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ id: verificationEvent.id }),
      expect.objectContaining({ recommendedAction: 'manual_review' }),
      1
    );
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
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
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

  it('does not consume an analysis slot when the notification update fails', async () => {
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
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(false),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
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
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { message, messages } = buildMessage();
      messages.set('msg-1', {
        id: 'msg-1',
        author: { id: 'user-1' },
        content: 'I joined for the weekly speedrun races.',
        createdTimestamp: 2,
      });

      const handled = await service.handleThreadMessage(message as any);

      expect(handled).toBe(true);
      expect(notificationManager.updateVerificationThreadAnalysis).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        `[VerificationThreadAnalysis] Failed to update notification for verification event ${verificationEvent.id}`
      );

      const updated = await verificationRepo.findById(verificationEvent.id);
      expect(updated?.metadata).toEqual({
        support_thread_reminder: {
          reminderCount: 0,
          userRespondedAt: '2026-06-03T12:00:00.000Z',
        },
      });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns and continues when metadata persistence fails after notification succeeds', async () => {
    const verificationEvent = {
      id: 'verification-1',
      detection_event_id: 'detection-1',
      server_id: 'guild-1',
      user_id: 'user-1',
      status: VerificationStatus.PENDING,
      thread_id: 'thread-1',
      notification_message_id: 'notif-1',
      metadata: null,
      created_at: new Date(),
      updated_at: new Date(),
      resolved_at: null,
      resolved_by: null,
      notes: null,
    } as any;
    const verificationRepo = {
      findByThreadId: jest.fn().mockResolvedValue(verificationEvent),
      findById: jest.fn().mockResolvedValue(verificationEvent),
      update: jest.fn().mockRejectedValue(new Error('db down')),
    } as any;
    const detectionRepo = {
      findById: jest.fn().mockResolvedValue({ reasons: ['Recent suspicious activity'] }),
    } as any;
    const gptService = {
      analyzeVerificationThreadResponses: jest.fn().mockResolvedValue({
        result: 'OK',
        confidence: 0.67,
        summary: 'Looks like a real user answering normally.',
      }),
    } as any;
    const notificationManager = {
      updateVerificationThreadAnalysis: jest.fn().mockResolvedValue(true),
      mirrorVerificationThreadMessageToEvidenceThread: jest.fn().mockResolvedValue(true),
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
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const { message, messages } = buildMessage();
      messages.set('msg-1', {
        id: 'msg-1',
        author: { id: 'user-1' },
        content: 'I joined for the weekly speedrun races.',
        createdTimestamp: 2,
      });

      await expect(service.handleThreadMessage(message as any)).resolves.toBe(true);
      expect(notificationManager.updateVerificationThreadAnalysis).toHaveBeenCalled();
      expect(verificationRepo.update).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[VerificationThreadAnalysis] Failed to persist metadata for verification event verification-1',
        expect.any(Error)
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
