import { DetectionOrchestrator } from '../../services/DetectionOrchestrator';
import { HeuristicService } from '../../services/HeuristicService';
import { GPTService, UserProfileData } from '../../services/GPTService';

// Mock both services
jest.mock('../../services/HeuristicService');
jest.mock('../../services/GPTService');

describe('DetectionOrchestrator', () => {
  // Setup variables
  let detectionOrchestrator: DetectionOrchestrator;
  let mockHeuristicService: jest.Mocked<HeuristicService>;
  let mockGPTService: jest.Mocked<GPTService>;

  // Sample user data for tests
  const userId = '123456789';
  const normalContent = 'Hello, how are you doing today?';
  const spammyContent = 'Free discord nitro! Click here!';

  // Sample profile data
  const normalUserProfile: UserProfileData = {
    username: 'NormalUser',
    discriminator: '1234',
    bio: 'I like coding and gaming',
    accountCreatedAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // 1 year old account
    joinedServerAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Joined 30 days ago
  };

  const newUserProfile: UserProfileData = {
    username: 'NewUser',
    bio: 'Just joined Discord!',
    accountCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days old account
    joinedServerAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // Joined 1 day ago
  };

  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks();

    // Create mock instances
    mockHeuristicService = new HeuristicService() as jest.Mocked<HeuristicService>;
    mockGPTService = new GPTService() as jest.Mocked<GPTService>;

    // Create orchestrator with mocked services
    detectionOrchestrator = new DetectionOrchestrator(mockHeuristicService, mockGPTService);
  });

  describe('detectMessage', () => {
    it('should classify obvious spam using heuristics alone (no GPT)', async () => {
      // Setup mocks for obvious spam
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(true);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(true);

      // Since this is obvious spam, GPT shouldn't be called

      // Call the method
      const result = await detectionOrchestrator.detectMessage(userId, spammyContent);

      // Verify the result
      expect(result.label).toBe('SUSPICIOUS');
      expect(result.confidence).toBeGreaterThan(0.5); // High confidence
      expect(result.usedGPT).toBe(false); // GPT was not used

      // Verify the heuristic service was called
      expect(mockHeuristicService.isFrequencyAboveThreshold).toHaveBeenCalledWith(userId);
      expect(mockHeuristicService.containsSuspiciousKeywords).toHaveBeenCalledWith(spammyContent);

      // Verify the GPT service was NOT called
      expect(mockGPTService.classifyUserProfile).not.toHaveBeenCalled();
    });

    it('should classify normal messages as OK using heuristics alone (no GPT)', async () => {
      // Setup mocks for normal content
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(false);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);

      // Call the method
      const result = await detectionOrchestrator.detectMessage(userId, normalContent);

      // Verify the result
      expect(result.label).toBe('OK');
      expect(result.usedGPT).toBe(false); // GPT was not used

      // Verify the heuristic service was called
      expect(mockHeuristicService.isFrequencyAboveThreshold).toHaveBeenCalledWith(userId);
      expect(mockHeuristicService.containsSuspiciousKeywords).toHaveBeenCalledWith(normalContent);

      // Verify the GPT service was NOT called
      expect(mockGPTService.classifyUserProfile).not.toHaveBeenCalled();
    });

    it('should use GPT for borderline cases', async () => {
      // Setup mocks for borderline case
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(true);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);

      // Mock GPT to return "OK"
      mockGPTService.classifyUserProfile.mockResolvedValue('OK');

      // Call the method with profile data (required for GPT)
      const result = await detectionOrchestrator.detectMessage(
        userId,
        normalContent,
        normalUserProfile
      );

      // Verify the result
      expect(result.label).toBe('OK'); // GPT overrode the borderline suspicion
      expect(result.usedGPT).toBe(true); // GPT was used

      // Verify the heuristic service was called
      expect(mockHeuristicService.isFrequencyAboveThreshold).toHaveBeenCalledWith(userId);
      expect(mockHeuristicService.containsSuspiciousKeywords).toHaveBeenCalledWith(normalContent);

      // Verify the GPT service was called
      expect(mockGPTService.classifyUserProfile).toHaveBeenCalled();
    });

    it('should always use GPT for new users', async () => {
      // Setup mocks for normal content but new user
      mockHeuristicService.isFrequencyAboveThreshold.mockReturnValue(false);
      mockHeuristicService.containsSuspiciousKeywords.mockReturnValue(false);

      // Mock GPT to return "SUSPICIOUS"
      mockGPTService.classifyUserProfile.mockResolvedValue('SUSPICIOUS');

      // Call the method with new user profile
      const result = await detectionOrchestrator.detectMessage(
        userId,
        normalContent,
        newUserProfile
      );

      // Verify the result
      expect(result.label).toBe('SUSPICIOUS'); // GPT flagged as suspicious
      expect(result.usedGPT).toBe(true); // GPT was used

      // Verify the heuristic service was called
      expect(mockHeuristicService.isFrequencyAboveThreshold).toHaveBeenCalledWith(userId);
      expect(mockHeuristicService.containsSuspiciousKeywords).toHaveBeenCalledWith(normalContent);

      // Verify the GPT service was called
      expect(mockGPTService.classifyUserProfile).toHaveBeenCalled();
    });
  });

  describe('detectNewJoin', () => {
    it('should always use GPT for new server joins', async () => {
      // Mock GPT to return "OK"
      mockGPTService.classifyUserProfile.mockResolvedValue('OK');

      // Call the method
      const result = await detectionOrchestrator.detectNewJoin(normalUserProfile);

      // Verify the result
      expect(result.label).toBe('OK');
      expect(result.usedGPT).toBe(true); // GPT was used

      // Verify the GPT service was called
      expect(mockGPTService.classifyUserProfile).toHaveBeenCalledWith(normalUserProfile);
    });

    it('should flag new accounts joining with higher suspicion', async () => {
      // Mock GPT to return "SUSPICIOUS"
      mockGPTService.classifyUserProfile.mockResolvedValue('SUSPICIOUS');

      // Call the method with new user
      const result = await detectionOrchestrator.detectNewJoin(newUserProfile);

      // Verify the result
      expect(result.label).toBe('SUSPICIOUS');
      expect(result.confidence).toBeGreaterThan(0.5); // High confidence
      expect(result.usedGPT).toBe(true); // GPT was used

      // Verify the GPT service was called
      expect(mockGPTService.classifyUserProfile).toHaveBeenCalledWith(newUserProfile);
    });
  });
});
