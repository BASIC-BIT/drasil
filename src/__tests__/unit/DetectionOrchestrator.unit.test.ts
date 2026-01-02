import { DetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { IHeuristicService } from '../../services/HeuristicService';
import { IGPTService, UserProfileData } from '../../services/GPTService';
import { DetectionType } from '../../repositories/types';
import {
  InMemoryDetectionEventsRepository,
  InMemoryServerRepository,
  InMemoryUserRepository,
} from '../fakes/inMemoryRepositories';

describe('DetectionOrchestrator (unit)', () => {
  const serverId = 'server-1';
  const userId = 'user-1';

  let heuristicService: jest.Mocked<IHeuristicService>;
  let gptService: jest.Mocked<IGPTService>;
  let detectionEventsRepository: InMemoryDetectionEventsRepository;
  let serverRepository: InMemoryServerRepository;
  let userRepository: InMemoryUserRepository;

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
    };
    detectionEventsRepository = new InMemoryDetectionEventsRepository();
    serverRepository = new InMemoryServerRepository();
    userRepository = new InMemoryUserRepository();
  });

  it('creates detection event without GPT when no profile data is provided', async () => {
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
    expect(result.detectionEventId).toBeDefined();

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(1);
    expect(events[0].detection_type).toBe(DetectionType.SUSPICIOUS_CONTENT);
    expect(events[0].metadata).toMatchObject({ content: 'hello' });
  });

  it('uses GPT for new accounts and returns suspicious when GPT flags it', async () => {
    heuristicService.analyzeMessage.mockReturnValue({ result: 'OK', reasons: [] });
    gptService.analyzeProfile.mockResolvedValue({
      result: 'SUSPICIOUS',
      confidence: 0.9,
      reasons: ['Suspicious profile'],
    });

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

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(1);
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
    gptService.analyzeProfile.mockResolvedValue({
      result: 'OK',
      confidence: 0.2,
      reasons: ['GPT OK'],
    });

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

    const result = await orchestrator.detectMessage(serverId, userId, 'free discord nitro', profile);

    expect(gptService.analyzeProfile).not.toHaveBeenCalled();
    expect(result.label).toBe('SUSPICIOUS');

    const events = await detectionEventsRepository.findByServerAndUser(serverId, userId);
    expect(events).toHaveLength(2);
  });
});
