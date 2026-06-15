import { DetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { IHeuristicService } from '../../services/HeuristicService';
import {
  GPT_PROFILE_MODEL,
  GPT_PROFILE_PROMPT_VERSION,
  GPTProfileAnalysis,
  IGPTService,
  UserProfileData,
} from '../../services/GPTService';
import { DetectionType } from '../../repositories/types';
import {
  InMemoryDetectionEventsRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';
import {
  DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY,
  DETECTION_TEST_MODE_METADATA_KEY,
} from '../../utils/detectionEventAccounting';

describe('DetectionOrchestrator (unit)', () => {
  const serverId = 'server-1';
  const userId = 'user-1';

  let heuristicService: jest.Mocked<IHeuristicService>;
  let gptService: jest.Mocked<IGPTService>;
  let detectionEventsRepository: InMemoryDetectionEventsRepository;
  let serverRepository: InMemoryServerRepository;
  let userRepository: InMemoryUserRepository;

  function makeGptAnalysis(overrides?: Partial<GPTProfileAnalysis>): GPTProfileAnalysis {
    return {
      result: 'OK',
      confidence: 0.2,
      reasons: ['AI analysis indicates user/message context is likely legitimate'],
      reasonCodes: ['normal_context'],
      primarySignal: 'none',
      summary: 'Context looks normal.',
      model: GPT_PROFILE_MODEL,
      promptVersion: GPT_PROFILE_PROMPT_VERSION,
      isFallback: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    heuristicService = {
      analyzeMessage: jest.fn(),
      isMessageSuspicious: jest.fn(),
      isFrequencyAboveThreshold: jest.fn(),
      containsSuspiciousKeywords: jest.fn(),
      clearMessageHistory: jest.fn(),
    };
    gptService = {
      analyzeProfile: jest.fn(),
      analyzeVerificationThreadResponses: jest.fn(),
      analyzeReportEvidence: jest.fn(),
      extractReportIntakeEvidence: jest.fn(),
    };
    detectionEventsRepository = new InMemoryDetectionEventsRepository();
    serverRepository = new InMemoryServerRepository();
    userRepository = new InMemoryUserRepository();
  });

  it('does not create a detection event when the final label is OK (no profile data)', async () => {
    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const result = await orchestrator.detectMessage(serverId, userId, 'hello');

    expect(gptService.analyzeProfile).not.toHaveBeenCalled();
    expect(result.label).toBe('OK');
    expect(result.detectionEventId).toBeUndefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(0);
  });

  it('creates a detection event when the final label is SUSPICIOUS (no profile data)', async () => {
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Suspicious keywords'],
    });

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const result = await orchestrator.detectMessage(serverId, userId, 'free nitro');

    expect(gptService.analyzeProfile).not.toHaveBeenCalled();
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detectionEventId).toBeDefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(1);
    expect(events[0].detection_type).toBe(DetectionType.SUSPICIOUS_CONTENT);
    expect(events[0].metadata).toMatchObject({ content: 'free nitro' });
  });

  it('excludes new detection events from accounting in detection test mode', async () => {
    const originalTestMode = process.env.DRASIL_DETECTION_TEST_MODE;
    const originalTestRunId = process.env.DRASIL_DETECTION_TEST_RUN_ID;
    process.env.DRASIL_DETECTION_TEST_MODE = 'true';
    process.env.DRASIL_DETECTION_TEST_RUN_ID = 'unit-run-1';
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Suspicious keywords'],
    });

    try {
      const orchestrator = new DetectionOrchestrator(
        heuristicService,
        gptService,
        detectionEventsRepository,
        userRepository,
        serverRepository
      );

      await orchestrator.detectMessage(serverId, userId, 'free nitro');

      const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({
        content: 'free nitro',
        test_mode: true,
        test_run_id: 'unit-run-1',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'system:test-mode',
        accounting_exclusion_reason: 'Detection test mode',
      });
      await expect(
        detectionEventsRepository.findCountedByServerAndUser(serverId, userId)
      ).resolves.toHaveLength(0);
    } finally {
      if (originalTestMode === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_MODE;
      } else {
        process.env.DRASIL_DETECTION_TEST_MODE = originalTestMode;
      }
      if (originalTestRunId === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_RUN_ID;
      } else {
        process.env.DRASIL_DETECTION_TEST_RUN_ID = originalTestRunId;
      }
    }
  });

  it('uses GPT for new accounts and returns suspicious when GPT flags it', async () => {
    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['AI analysis flagged recent message context as suspicious'],
        reasonCodes: ['suspicious_keyword'],
        primarySignal: 'message_content',
        summary: 'Recent message context matches common scam patterns.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'new-user',
      accountCreatedAt: new Date(),
      joinedServerAt: new Date(),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(serverId, userId, 'hello', profile);

    expect(gptService.analyzeProfile).toHaveBeenCalledTimes(1);
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detectionEventId).toBeDefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({
      gpt: {
        result: 'SUSPICIOUS',
        is_fallback: false,
        primary_signal: 'message_content',
        reason_codes: ['suspicious_keyword'],
      },
    });
  });

  it('skips GPT when recent high-confidence detections exist', async () => {
    await detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Previous high-confidence detection'],
      detected_at: new Date(),
    });

    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Suspicious keywords'],
    });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'OK',
        confidence: 0.2,
        reasons: ['GPT OK'],
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'old-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(
      serverId,
      userId,
      'free discord nitro',
      profile
    );

    expect(gptService.analyzeProfile).not.toHaveBeenCalled();
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detectionEventId).toBeDefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(2);
  });

  it('uses GPT for established users when message detection is forced', async () => {
    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.85,
        reasons: ['AI analysis flagged recent message context as suspicious'],
        reasonCodes: ['call_to_action'],
        primarySignal: 'message_content',
        summary: 'Recent message context contains suspicious outreach.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'established-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(
      serverId,
      userId,
      'commission advert',
      profile,
      {
        forceGpt: true,
      }
    );

    expect(gptService.analyzeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        recentMessages: ['commission advert'],
      })
    );
    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detectionEventId).toBeDefined();
  });

  it('does not count false-positive detections toward future suspicion', async () => {
    await detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Previous high-confidence detection'],
      detected_at: new Date(),
      metadata: { observed_action: 'false_positive' },
    });

    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'restored-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(serverId, userId, 'Set tonight!', profile);

    expect(result.label).toBe('OK');
    expect(result.reasons).not.toContain('Recent suspicious activity');
    expect(profile.pastDetectionCount).toBe(0);
    expect(profile.pastFalsePositiveDetectionCount).toBe(1);
    expect(profile.recentHighConfidenceDetectionCount).toBe(0);
  });

  it('passes false-positive detection history to GPT separately from counted history', async () => {
    await detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Previous high-confidence detection'],
      detected_at: new Date(),
      metadata: { observed_action: 'false_positive' },
    });

    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });
    gptService.analyzeProfile.mockResolvedValue(makeGptAnalysis());

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'new-user',
      accountCreatedAt: new Date(),
      joinedServerAt: new Date(),
      recentMessages: [],
    };

    await orchestrator.detectMessage(serverId, userId, 'hello', profile);

    expect(gptService.analyzeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        pastDetectionCount: 0,
        pastFalsePositiveDetectionCount: 1,
        recentHighConfidenceDetectionCount: 0,
      })
    );
  });

  it('does not count non-false-positive exclusions as false-positive GPT context', async () => {
    await detectionEventsRepository.create({
      server_id: serverId,
      user_id: userId,
      detection_type: DetectionType.SUSPICIOUS_CONTENT,
      confidence: 0.9,
      reasons: ['Detection test run'],
      detected_at: new Date(),
      metadata: {
        [DETECTION_ACCOUNTING_EXCLUDED_METADATA_KEY]: true,
        [DETECTION_TEST_MODE_METADATA_KEY]: true,
      },
    });

    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });
    gptService.analyzeProfile.mockResolvedValue(makeGptAnalysis());

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'new-user',
      accountCreatedAt: new Date(),
      joinedServerAt: new Date(),
      recentMessages: [],
    };

    await orchestrator.detectMessage(serverId, userId, 'hello', profile);

    expect(gptService.analyzeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        pastDetectionCount: 0,
        pastFalsePositiveDetectionCount: 0,
        recentHighConfidenceDetectionCount: 0,
      })
    );
  });

  it('does not reduce message suspicion when GPT analysis is unavailable', async () => {
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Suspicious keywords'],
    });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'OK',
        confidence: 0.1,
        reasons: ['AI analysis unavailable; review manually'],
        reasonCodes: ['ai_analysis_unavailable'],
        primarySignal: 'none',
        summary: 'AI analysis failed; review manually.',
        isFallback: true,
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'new-user',
      accountCreatedAt: new Date(),
      joinedServerAt: new Date(),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(serverId, userId, 'free nitro', profile);

    expect(result.label).toBe('SUSPICIOUS');
    expect(result.reasons).toEqual(
      expect.arrayContaining(['Suspicious keywords', 'AI analysis unavailable; review manually'])
    );
    expect(result.reasons).not.toContain('GPT analysis indicates user is likely legitimate');
  });

  it('downgrades bare suspicious keywords for an established user when GPT finds insufficient signal', async () => {
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Message contains suspicious keywords or patterns'],
    });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'OK',
        confidence: 0.7,
        reasons: ['AI analysis indicates user/message context is likely legitimate'],
        reasonCodes: ['insufficient_signal', 'trusted_member_context'],
        primarySignal: 'none',
        summary: 'Keyword-only context lacks scam mechanics.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'established-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: ['normal conversation'],
      channelContext: ['other_user: joking about old scams'],
      hasModerationPermissions: false,
      moderationPermissions: [],
    };

    const result = await orchestrator.detectMessage(serverId, userId, 'free nitro', profile);

    expect(gptService.analyzeProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        pastDetectionCount: 0,
        recentHighConfidenceDetectionCount: 0,
        recentMessages: ['normal conversation', 'free nitro'],
      })
    );
    expect(result.label).toBe('OK');
    expect(result.detectionEventId).toBeUndefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(0);
  });

  it('uses GPT confidence instead of forcing every GPT suspicious message to high confidence', async () => {
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Message contains suspicious keywords or patterns'],
    });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.6,
        reasons: ['AI analysis flagged recent message context as suspicious'],
        reasonCodes: ['suspicious_keyword', 'insufficient_signal'],
        primarySignal: 'message_content',
        summary: 'Some weak message-content signal exists.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'established-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectMessage(serverId, userId, 'free nitro', profile);

    expect(result.label).toBe('SUSPICIOUS');
    expect(result.confidence).toBeCloseTo(0.2);
    expect(result.confidence).toBeLessThan(0.7);
  });

  it('keeps strong link-and-CTA scam evidence suspicious for established users', async () => {
    heuristicService.analyzeMessage.mockReturnValue({
      result: 'SUSPICIOUS',
      reasons: ['Message contains suspicious keywords or patterns'],
    });
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.95,
        reasons: ['AI analysis flagged recent message context as suspicious'],
        reasonCodes: ['scam_link', 'call_to_action'],
        primarySignal: 'message_content',
        summary: 'Link and call-to-action match scam mechanics.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'established-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: ['normal conversation'],
    };

    const result = await orchestrator.detectMessage(
      serverId,
      userId,
      'free nitro claim here https://example.test',
      profile
    );

    expect(result.label).toBe('SUSPICIOUS');
    expect(result.confidence).toBeCloseTo(0.9);
    expect(result.detectionEventId).toBeDefined();
  });

  it('does not create a detection event for an OK new join', async () => {
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'OK',
        confidence: 0.2,
        reasons: ['GPT OK'],
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'old-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectNewJoin(serverId, userId, profile);

    expect(result.label).toBe('OK');
    expect(result.detectionEventId).toBeUndefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(0);
  });

  it('creates a detection event for a suspicious new join', async () => {
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['AI analysis flagged user/message context as suspicious'],
        reasonCodes: ['unusual_username'],
        primarySignal: 'username',
        summary: 'Username context looks suspicious.',
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'old-user',
      accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
      joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
      recentMessages: [],
    };

    const result = await orchestrator.detectNewJoin(serverId, userId, profile);

    expect(result.label).toBe('SUSPICIOUS');
    expect(result.detectionEventId).toBeDefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(1);
    expect(events[0].detection_type).toBe(DetectionType.NEW_ACCOUNT);
    expect(events[0].metadata).toMatchObject({
      join: true,
      gpt: {
        result: 'SUSPICIOUS',
        is_fallback: false,
        primary_signal: 'username',
        reason_codes: ['unusual_username'],
      },
    });
  });

  it('clamps suspicious new-join confidence to 100%', async () => {
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['AI analysis flagged user/message context as suspicious'],
      })
    );

    const orchestrator = new DetectionOrchestrator(
      heuristicService,
      gptService,
      detectionEventsRepository,
      userRepository,
      serverRepository
    );

    const profile: UserProfileData = {
      username: 'new-user',
      accountCreatedAt: new Date(),
      joinedServerAt: new Date(),
      recentMessages: [],
    };

    const result = await orchestrator.detectNewJoin(serverId, userId, profile);
    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);

    expect(result.label).toBe('SUSPICIOUS');
    expect(result.confidence).toBe(1);
    expect(events[0].confidence).toBe(1);
  });

  it('excludes suspicious new joins from accounting in detection test mode', async () => {
    const originalTestMode = process.env.DRASIL_DETECTION_TEST_MODE;
    const originalTestRunId = process.env.DRASIL_DETECTION_TEST_RUN_ID;
    process.env.DRASIL_DETECTION_TEST_MODE = 'true';
    process.env.DRASIL_DETECTION_TEST_RUN_ID = 'join-test-run';
    gptService.analyzeProfile.mockResolvedValue(
      makeGptAnalysis({
        result: 'SUSPICIOUS',
        confidence: 0.9,
        reasons: ['AI analysis flagged user/message context as suspicious'],
        reasonCodes: ['unusual_username'],
        primarySignal: 'username',
        summary: 'Username context looks suspicious.',
      })
    );

    try {
      const orchestrator = new DetectionOrchestrator(
        heuristicService,
        gptService,
        detectionEventsRepository,
        userRepository,
        serverRepository
      );

      const profile: UserProfileData = {
        username: 'old-user',
        accountCreatedAt: new Date('2020-01-01T00:00:00.000Z'),
        joinedServerAt: new Date('2020-01-01T00:00:00.000Z'),
        recentMessages: [],
      };

      await orchestrator.detectNewJoin(serverId, userId, profile);

      const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({
        join: true,
        test_mode: true,
        test_run_id: 'join-test-run',
        excluded_from_accounting: true,
        accounting_exclusion_scope: 'server',
        accounting_excluded_by: 'system:test-mode',
        accounting_exclusion_reason: 'Detection test mode',
      });
      await expect(
        detectionEventsRepository.findCountedByServerAndUser(serverId, userId)
      ).resolves.toHaveLength(0);
    } finally {
      if (originalTestMode === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_MODE;
      } else {
        process.env.DRASIL_DETECTION_TEST_MODE = originalTestMode;
      }
      if (originalTestRunId === undefined) {
        delete process.env.DRASIL_DETECTION_TEST_RUN_ID;
      } else {
        process.env.DRASIL_DETECTION_TEST_RUN_ID = originalTestRunId;
      }
    }
  });
});
