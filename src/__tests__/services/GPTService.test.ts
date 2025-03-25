import { GPTService, UserProfileData } from '../../services/GPTService';

// Use jest.mock to automatically mock the openai module
jest.mock('openai');

// Import the mockCreate from our mocks
import { __mockCreate as mockCreate } from '../../__mocks__/openai';

describe('GPTService', () => {
  let gptService: GPTService;

  // Create sample user profile data for testing
  const normalUser: UserProfileData = {
    username: 'normal_user',
    discriminator: '1234',
    bio: 'I am a legitimate user who enjoys gaming and art.',
    accountCreatedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days old
    joinedServerAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Joined 30 days ago
    connectedAccounts: ['Spotify', 'Xbox'],
  };

  const suspiciousUser: UserProfileData = {
    username: 'free_nitro_giveaway',
    discriminator: '9999',
    bio: 'Click my profile for FREE DISCORD NITRO! Check my website!',
    accountCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Only 2 days old
    joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
    connectedAccounts: [],
  };

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a new instance of GPTService
    gptService = new GPTService();
  });

  describe('classifyUserProfile', () => {
    it('should classify normal users as "OK"', async () => {
      // Mock the OpenAI API response for a normal user
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'OK - This user appears to be legitimate based on account age and normal bio.',
            },
          },
        ],
      });

      // Call the method and expect "OK" result
      const result = await gptService.classifyUserProfile(normalUser);
      expect(result).toBe('OK');

      // Verify the OpenAI API was called with expected parameters
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate.mock.calls[0][0].messages[0].role).toBe('system');
      expect(mockCreate.mock.calls[0][0].model).toBe('gpt-4o-mini');
    });

    it('should classify suspicious users as "SUSPICIOUS"', async () => {
      // Mock the OpenAI API response for a suspicious user
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'SUSPICIOUS - New account with suspicious username and bio mentioning free nitro.',
            },
          },
        ],
      });

      // Call the method and expect "SUSPICIOUS" result
      const result = await gptService.classifyUserProfile(suspiciousUser);
      expect(result).toBe('SUSPICIOUS');

      // Verify the OpenAI API was called with expected parameters
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should default to "OK" if API call fails', async () => {
      // Mock an API error
      mockCreate.mockRejectedValueOnce(new Error('API Error'));

      // Call the method and expect "OK" result (default for error case)
      const result = await gptService.classifyUserProfile(normalUser);
      expect(result).toBe('OK');

      // Verify the OpenAI API was called
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should default to "OK" if response is unclear', async () => {
      // Mock unclear or empty response
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'I am not sure about this user.',
            },
          },
        ],
      });

      // Call the method and expect "OK" result (default for unclear response)
      const result = await gptService.classifyUserProfile(normalUser);
      expect(result).toBe('OK');

      // Verify the OpenAI API was called
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
