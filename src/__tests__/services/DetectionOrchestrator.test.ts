import 'reflect-metadata';
import { Container } from 'inversify';
import {
  DetectionOrchestrator,
  IDetectionOrchestrator,
} from '../../services/DetectionOrchestrator';
import { UserProfileData } from '../../services/GPTService';
import { TYPES } from '../../di/symbols';
import { createServiceTestContainer, createMocks } from '../utils/test-container';

describe('DetectionOrchestrator', () => {
  // Setup variables
  let container: Container;
  let detectionOrchestrator: IDetectionOrchestrator;
  let mocks: ReturnType<typeof createMocks>;

  // Sample user data for tests
  const userId = '123456789';

  beforeEach(() => {
    // Create mocks and customize as needed
    mocks = createMocks();

    // Configure mocks for specific tests
    mocks.mockDetectionEventsRepository.findByServerAndUser.mockResolvedValue([]);

    // Create container with real DetectionOrchestrator and mocked dependencies
    container = createServiceTestContainer(TYPES.DetectionOrchestrator, DetectionOrchestrator, {
      mockHeuristicService: mocks.mockHeuristicService,
      mockGPTService: mocks.mockGPTService,
      mockDetectionEventsRepository: mocks.mockDetectionEventsRepository,
      mockUserRepository: mocks.mockUserRepository,
      mockServerRepository: mocks.mockServerRepository,
      mockServerMemberRepository: mocks.mockServerMemberRepository,
    });

    // Get the service from the container
    detectionOrchestrator = container.get<IDetectionOrchestrator>(TYPES.DetectionOrchestrator);
  });

  describe('detectMessage', () => {
    const serverId = 'server123';
    const content = 'test message';

    beforeEach(() => {
      mocks.mockDetectionEventsRepository.findByServerAndUser.mockResolvedValue([]);
    });

    it('should store detection results in the database', async () => {
      mocks.mockHeuristicService.analyzeMessage.mockReturnValue({
        result: 'OK',
        reasons: [],
      });

      await detectionOrchestrator.detectMessage(serverId, userId, content);

      expect(mocks.mockDetectionEventsRepository.findByServerAndUser).toHaveBeenCalledWith(
        serverId,
        userId
      );
    });

    it('should consider recent suspicious events', async () => {
      // Mock recent suspicious events
      mocks.mockDetectionEventsRepository.findByServerAndUser.mockResolvedValue([
        {
          confidence_level: 'High',
          detected_at: new Date().toISOString(),
        } as any,
      ]);

      mocks.mockHeuristicService.analyzeMessage.mockReturnValue({
        result: 'OK',
        reasons: [],
      });

      const result = await detectionOrchestrator.detectMessage(serverId, userId, content);

      expect(result.reasons).toContain('Recent suspicious activity');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should use GPT for borderline cases', async () => {
      // Set up a borderline suspicious result
      mocks.mockHeuristicService.analyzeMessage.mockReturnValue({
        result: 'SUSPICIOUS',
        reasons: ['Suspicious keyword detected'],
      });

      // Mock GPT to flag as suspicious
      mocks.mockGPTService.analyzeProfile.mockResolvedValue({
        result: 'SUSPICIOUS',
        confidence: 0.8,
        reasons: ['GPT analysis detected suspicious pattern'],
      });

      const profileData: UserProfileData = {
        username: 'TestUser',
        accountCreatedAt: new Date(),
        joinedServerAt: new Date(),
      };

      const result = await detectionOrchestrator.detectMessage(
        serverId,
        userId,
        content,
        profileData
      );

      expect(mocks.mockGPTService.analyzeProfile).toHaveBeenCalled();
      expect(result.usedGPT).toBe(true);
    });
  });

  describe('detectNewJoin', () => {
    const serverId = 'server123';

    it('should always use GPT and store results', async () => {
      // Mock GPT to return OK
      mocks.mockGPTService.analyzeProfile.mockResolvedValue({
        result: 'OK',
        confidence: 0.2,
        reasons: ['User appears legitimate'],
      });

      const profileData: UserProfileData = {
        username: 'TestUser',
        accountCreatedAt: new Date(),
        joinedServerAt: new Date(),
      };

      const result = await detectionOrchestrator.detectNewJoin(serverId, userId, profileData);

      expect(mocks.mockGPTService.analyzeProfile).toHaveBeenCalled();
      expect(result.usedGPT).toBe(true);
    });

    it('should handle new accounts with higher suspicion', async () => {
      // Create a date for a new account (3 days old)
      const newAccountDate = new Date();
      newAccountDate.setDate(newAccountDate.getDate() - 3);

      // Mock GPT to flag as suspicious
      mocks.mockGPTService.analyzeProfile.mockResolvedValue({
        result: 'SUSPICIOUS',
        confidence: 0.8,
        reasons: ['Suspicious profile detected'],
      });

      const result = await detectionOrchestrator.detectNewJoin(serverId, userId, {
        username: 'NewUser',
        accountCreatedAt: newAccountDate,
        joinedServerAt: new Date(),
      });

      expect(result.reasons).toContain('New Discord account');
      expect(result.label).toBe('SUSPICIOUS');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });
});
