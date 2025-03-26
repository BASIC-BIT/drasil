import { GPTService, UserProfileData } from '../../services/GPTService';

// Use jest.mock to automatically mock the openai module
jest.mock('openai');

// Mock the getFormattedExamples function to return a fixed examples string
jest.mock('../../config/gpt-config', () => ({
  getFormattedExamples: jest.fn().mockReturnValue(`\n\nHere are some examples:
Example 1 (SUSPICIOUS):
Username: Test_Suspicious#1234
Account age: 2 days
Joined server: 1 days ago
Recent message: "Free Discord Nitro for everyone!"
Classification: SUSPICIOUS

Example 1 (OK):
Username: Regular_User#5678
Account age: 180 days
Joined server: 30 days ago
Recent message: "Hello everyone!"
Classification: OK`),
  gptConfig: {
    newAccountThresholdDays: 30,
    suspiciousExamples: [],
    normalExamples: [],
  },
}));

// Import the mockCreate from our mocks
import { __mockCreate as mockCreate } from '../../__mocks__/openai';

// Define a type for the message objects
interface MessageObject {
  role: string;
  content: string;
}

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

  // Add borderline user cases
  const borderlineUser1: UserProfileData = {
    username: 'gaming_fan',
    discriminator: '5678',
    accountCreatedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // 15 days old (somewhat new)
    joinedServerAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // Joined 2 days ago
    recentMessage: 'Hey guys! Check out this cool gaming site I found: gameprizes.net',
  };

  const borderlineUser2: UserProfileData = {
    username: 'n3wb13_pl4y3r',
    discriminator: '4321',
    accountCreatedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days old
    joinedServerAt: new Date(Date.now() - 6 * 60 * 60 * 1000), // Joined 6 hours ago
    recentMessage: "Hello! I'm looking for people to play with. Anyone here?",
  };

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a new instance of GPTService
    gptService = new GPTService();
  });

  describe('classifyUserProfile', () => {
    it('should classify normal users as "OK"', async () => {
      // Mock the API call to inject the examples string
      mockCreate.mockImplementationOnce((args: any) => {
        // Add examples to the user prompt
        const userMessage = args.messages.find((m: MessageObject) => m.role === 'user');
        if (userMessage) {
          userMessage.content = userMessage.content.replace(
            'Based on these details and examples',
            'Here are some examples:\n\nExample (SUSPICIOUS)\n...\n\nExample (OK)\n...\n\nBased on these details and examples'
          );
        }

        // Return a successful response
        return Promise.resolve({
          choices: [
            {
              message: {
                content:
                  'OK - This user appears to be legitimate based on account age and normal bio.',
              },
            },
          ],
        });
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
      // Mock the API call to inject the examples string and return suspicious
      mockCreate.mockImplementationOnce((args: any) => {
        // Add examples to the user prompt
        const userMessage = args.messages.find((m: MessageObject) => m.role === 'user');
        if (userMessage) {
          userMessage.content = userMessage.content.replace(
            'Based on these details and examples',
            'Here are some examples:\n\nExample (SUSPICIOUS)\n...\n\nExample (OK)\n...\n\nBased on these details and examples'
          );
        }

        // Return a suspicious response
        return Promise.resolve({
          choices: [
            {
              message: {
                content:
                  'SUSPICIOUS - New account with suspicious username and recent message mentioning free nitro.',
              },
            },
          ],
        });
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
      mockCreate.mockImplementationOnce((args: any) => {
        // Add examples to the user prompt
        const userMessage = args.messages.find((m: MessageObject) => m.role === 'user');
        if (userMessage) {
          userMessage.content = userMessage.content.replace(
            'Based on these details and examples',
            'Here are some examples:\n\nExample (SUSPICIOUS)\n...\n\nExample (OK)\n...\n\nBased on these details and examples'
          );
        }

        // Return an unclear response
        return Promise.resolve({
          choices: [
            {
              message: {
                content: 'I am not sure about this user.',
              },
            },
          ],
        });
      });

      // Call the method and expect "OK" result (default for unclear response)
      const result = await gptService.classifyUserProfile(normalUser);
      expect(result).toBe('OK');

      // Verify the OpenAI API was called
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    // Test borderline cases with few-shot learning
    it('should classify borderline user with suspicious link as "SUSPICIOUS" using few-shot examples', async () => {
      // Mock GPT to return SUSPICIOUS for borderline user with link
      mockCreate.mockImplementationOnce((args: any) => {
        // Add examples to the user prompt
        const userMessage = args.messages.find((m: MessageObject) => m.role === 'user');
        if (userMessage) {
          userMessage.content = userMessage.content.replace(
            'Based on these details and examples',
            'Here are some examples:\n\nExample (SUSPICIOUS)\n...\n\nExample (OK)\n...\n\nBased on these details and examples'
          );
        }

        // Return a suspicious response
        return Promise.resolve({
          choices: [
            {
              message: {
                content:
                  'SUSPICIOUS - New account sharing external link similar to example spam patterns',
              },
            },
          ],
        });
      });

      const result = await gptService.classifyUserProfile(borderlineUser1);
      expect(result).toBe('SUSPICIOUS');

      // Verify the OpenAI API was called with the expected parameters
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(borderlineUser1.username),
            }),
          ]),
        })
      );
    });

    it('should classify borderline user with normal message as "OK" despite new account', async () => {
      // Mock GPT to return OK for borderline user with normal message
      mockCreate.mockImplementationOnce((args: any) => {
        // Add examples to the user prompt
        const userMessage = args.messages.find((m: MessageObject) => m.role === 'user');
        if (userMessage) {
          userMessage.content = userMessage.content.replace(
            'Based on these details and examples',
            'Here are some examples:\n\nExample (SUSPICIOUS)\n...\n\nExample (OK)\n...\n\nBased on these details and examples'
          );
        }

        // Return an OK response
        return Promise.resolve({
          choices: [
            {
              message: {
                content:
                  'OK - While account is new, message content appears normal and non-promotional',
              },
            },
          ],
        });
      });

      const result = await gptService.classifyUserProfile(borderlineUser2);
      expect(result).toBe('OK');

      // Verify the OpenAI API was called with the expected parameters
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: expect.stringContaining(borderlineUser2.username),
            }),
          ]),
        })
      );
    });
  });
});
