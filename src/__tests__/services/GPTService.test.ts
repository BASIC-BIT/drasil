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
    accountCreatedAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 180 days old
    joinedServerAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Joined 30 days ago
    recentMessage: "Hello everyone, I'm new here!",
  };

  const suspiciousUser: UserProfileData = {
    username: 'free_nitro_giveaway',
    discriminator: '9999',
    accountCreatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Only 2 days old
    joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // Joined 1 hour ago
    recentMessage: 'Click my profile for FREE DISCORD NITRO! Check my website!',
  };

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a new instance of GPTService
    gptService = new GPTService();
  });

  describe('classifyUserProfile', () => {
    it('should classify normal users as "OK"', async () => {
      // Mock the OpenAI API to return a successful response
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

      // Call the method
      const result = await gptService.classifyUserProfile(normalUser);

      // Verify the result
      expect(result).toBe('OK');

      // Verify the OpenAI API was called with the expected parameters
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(normalUser.username),
            }),
          ]),
        })
      );
    });

    it('should classify suspicious users as "SUSPICIOUS"', async () => {
      // Mock the OpenAI API to return a suspicious response
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                'SUSPICIOUS - New account with suspicious username and recent message mentioning free nitro.',
            },
          },
        ],
      });

      // Call the method
      const result = await gptService.classifyUserProfile(suspiciousUser);

      // Verify the result
      expect(result).toBe('SUSPICIOUS');

      // Verify the OpenAI API was called with the expected parameters
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(suspiciousUser.username),
            }),
          ]),
        })
      );
    });

    it('should default to "OK" if API call fails', async () => {
      // Mock the OpenAI API to throw an error
      mockCreate.mockRejectedValueOnce(new Error('API Error'));

      // Call the method and expect "OK" result (default for errors)
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
