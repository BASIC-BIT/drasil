import { DetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { HeuristicService } from '../../services/HeuristicService';
import { GPTService, UserProfileData } from '../../services/GPTService';
import { DetectionEventsRepository } from '../../repositories/DetectionEventsRepository';

// Mock both services
jest.mock('../../services/HeuristicService');
jest.mock('../../services/GPTService');
jest.mock('../../repositories/DetectionEventsRepository');

describe('DetectionOrchestrator', () => {
  // Setup variables
  let detectionOrchestrator: DetectionOrchestrator;
  let mockHeuristicService: jest.Mocked<HeuristicService>;
  let mockGPTService: jest.Mocked<GPTService>;
  let detectionEventsRepository: jest.Mocked<DetectionEventsRepository>;

  // Sample user data for tests
  const userId = '123456789';

  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks();

    // Create mock instances
    mockHeuristicService = new HeuristicService() as jest.Mocked<HeuristicService>;
    mockGPTService = new GPTService() as jest.Mocked<GPTService>;
    detectionEventsRepository = {
      create: jest.fn(),
      findByServerAndUser: jest.fn(),
    } as any;

    // Create orchestrator with mocked services
    detectionOrchestrator = new DetectionOrchestrator(
      mockHeuristicService,
      mockGPTService,
      detectionEventsRepository
    );
  });

  describe('detectMessage', () => {
    const serverId = 'server123';
    const content = 'test message';

    beforeEach(() => {
      detectionEventsRepository.findByServerAndUser.mockResolvedValue([]);
    });

    it('should store detection results in the database', async () => {
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(false);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);

      await detectionOrchestrator.detectMessage(serverId, userId, content);

      expect(detectionEventsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: serverId,
          user_id: userId,
          message_id: content,
          detection_type: 'MESSAGE',
          confidence: expect.any(Number),
          confidence_level: expect.any(String),
          reasons: expect.any(Array),
          used_gpt: false,
          detected_at: expect.any(Date),
        })
      );
    });

    it('should consider recent suspicious events', async () => {
      detectionEventsRepository.findByServerAndUser.mockResolvedValue([
        {
          confidence_level: 'High',
          detected_at: new Date(),
        } as any,
      ]);

      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(false);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);

      const result = await detectionOrchestrator.detectMessage(serverId, userId, content);

      expect(result.reasons).toContain('Recent suspicious activity');
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should use GPT for borderline cases', async () => {
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(true);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);
      mockGPTService.classifyUserProfile.mockResolvedValue('SUSPICIOUS');

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

      expect(mockGPTService.classifyUserProfile).toHaveBeenCalled();
      expect(result.usedGPT).toBe(true);
      expect(detectionEventsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          used_gpt: true,
        })
      );
    });
  });

  describe('detectNewJoin', () => {
    const serverId = 'server123';

    it('should always use GPT and store results', async () => {
      mockGPTService.classifyUserProfile.mockResolvedValue('OK');

      const profileData: UserProfileData = {
        username: 'TestUser',
        accountCreatedAt: new Date(),
        joinedServerAt: new Date(),
      };

      const result = await detectionOrchestrator.detectNewJoin(serverId, userId, profileData);

      expect(mockGPTService.classifyUserProfile).toHaveBeenCalled();
      expect(result.usedGPT).toBe(true);
      expect(detectionEventsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          server_id: serverId,
          user_id: userId,
          detection_type: 'JOIN',
          used_gpt: true,
          detected_at: expect.any(Date),
        })
      );
    });

    it('should handle new accounts with higher suspicion', async () => {
      const newAccountDate = new Date();
      newAccountDate.setDate(newAccountDate.getDate() - 3); // 3 days old account

      mockGPTService.classifyUserProfile.mockResolvedValue('SUSPICIOUS');

      const result = await detectionOrchestrator.detectNewJoin(serverId, userId, {
        username: 'NewUser',
        accountCreatedAt: newAccountDate,
        joinedServerAt: new Date(),
      });

      expect(result.reasons).toContain('New Discord account');
      expect(result.reasons).toContain('GPT analysis flagged as suspicious');
      expect(result.confidence).toBeGreaterThan(0.5);
    });
  });

  describe('confidence level conversion', () => {
    it('should correctly categorize confidence levels', async () => {
      // Mock findByServerAndUser to return an empty array
      detectionEventsRepository.findByServerAndUser.mockResolvedValue([]);

      // Test message detection with different confidence levels
      await detectionOrchestrator.detectMessage('server1', 'user1', 'Test message', {
        username: 'test-user',
        accountCreatedAt: new Date(),
        joinedServerAt: new Date(),
      });

      // Check that the detection result was created with a confidence level
      expect(detectionEventsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence_level: expect.stringMatching(/^(Low|Medium|High)$/),
        })
      );
    });
  });
});
