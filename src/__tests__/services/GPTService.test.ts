import { OpenAI } from 'openai';
import { GPTService, UserProfileData } from '../../services/GPTService';
import { createServiceTestContainer } from '../utils/test-container';
import { TYPES } from '../../di/symbols';

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

// Define a type for the message objects
interface MessageObject {
  role: string;
  content: string;
}

describe('GPTService', () => {
  let gptService: GPTService;
  let mockOpenAI: any;

  const normalUser: UserProfileData = {
    username: 'normal_user',
    accountCreatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days old
    joinedServerAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // joined 30 days ago
    recentMessage: 'Hello everyone, how are you doing today?',
  };

  const suspiciousUser: UserProfileData = {
    username: 'free_nitro_discord',
    accountCreatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
    joinedServerAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // joined 1 hour ago
    recentMessage: 'Free Discord Nitro at https://discordnitro.gift',
  };

  const borderlineUser1: UserProfileData = {
    username: 'jane_smith',
    accountCreatedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days old
    joinedServerAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // joined 1 day ago
    recentMessage: 'Check out this cool website: https://example.com/offer',
  };

  const borderlineUser2: UserProfileData = {
    username: 'new_gamer123',
    accountCreatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days old
    joinedServerAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // joined 2 hours ago
    recentMessage: "Hi everyone, I'm new here. Does anyone play Minecraft?",
  };

  beforeEach(() => {
    // Create a new mock OpenAI instance for each test
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    // Create a container with real GPTService but mocked dependencies
    const container = createServiceTestContainer(TYPES.GPTService, GPTService, {
      mockOpenAI: mockOpenAI as unknown as OpenAI,
    });

    // Get the service from the container
    gptService = container.get<GPTService>(TYPES.GPTService);
  });

  describe('analyzeProfile', () => {
    it('should return "OK" for normal users', async () => {
      // Mock the API call to inject the examples string and return OK
      mockOpenAI.chat.completions.create.mockImplementationOnce((args: any) => {
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

      // Call the public method
      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: normalUser.username,
        accountAge: 90,
        joinedServer: normalUser.joinedServerAt,
        messageHistory: normalUser.recentMessage ? [normalUser.recentMessage] : [],
      });

      // Verify the result
      expect(result.result).toBe('OK');
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reasons.length).toBeGreaterThan(0);

      // Verify the OpenAI API was called with the expected parameters
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
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

    it('should return "SUSPICIOUS" for suspicious users', async () => {
      // Mock the API call to inject the examples string and return suspicious
      mockOpenAI.chat.completions.create.mockImplementationOnce((args: any) => {
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

      // Call the public method
      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: suspiciousUser.username,
        accountAge: 1,
        joinedServer: suspiciousUser.joinedServerAt,
        messageHistory: suspiciousUser.recentMessage ? [suspiciousUser.recentMessage] : [],
      });

      // Verify the result
      expect(result.result).toBe('SUSPICIOUS');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should default to "OK" if API call fails', async () => {
      // Mock the OpenAI API to throw an error
      mockOpenAI.chat.completions.create.mockRejectedValueOnce(new Error('API Error'));

      // Call the public method and expect "OK" result (default for errors)
      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: normalUser.username,
        accountAge: 90,
        joinedServer: normalUser.joinedServerAt,
        messageHistory: normalUser.recentMessage ? [normalUser.recentMessage] : [],
      });

      expect(result.result).toBe('OK');
      expect(result.confidence).toBeLessThan(0.5);
      expect(result.reasons).toContain('User profile appears normal');

      // Verify the OpenAI API was called
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalledTimes(1);
    });

    it('should default to "OK" if response is unclear', async () => {
      // Mock unclear or empty response
      mockOpenAI.chat.completions.create.mockImplementationOnce((args: any) => {
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

      // Call the public method
      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: normalUser.username,
        accountAge: 90,
        joinedServer: normalUser.joinedServerAt,
        messageHistory: normalUser.recentMessage ? [normalUser.recentMessage] : [],
      });

      expect(result.result).toBe('OK');
    });

    // Test borderline cases with few-shot learning
    it('should classify borderline user with suspicious link as "SUSPICIOUS" using few-shot examples', async () => {
      // Mock GPT to return SUSPICIOUS for borderline user with link
      mockOpenAI.chat.completions.create.mockImplementationOnce((args: any) => {
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

      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: borderlineUser1.username,
        accountAge: 5,
        joinedServer: borderlineUser1.joinedServerAt,
        messageHistory: borderlineUser1.recentMessage ? [borderlineUser1.recentMessage] : [],
      });

      expect(result.result).toBe('SUSPICIOUS');
    });

    it('should classify borderline user with normal message as "OK" despite new account', async () => {
      // Mock GPT to return OK for borderline user with normal message
      mockOpenAI.chat.completions.create.mockImplementationOnce((args: any) => {
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

      const result = await gptService.analyzeProfile({
        userId: '123456789',
        username: borderlineUser2.username,
        accountAge: 3,
        joinedServer: borderlineUser2.joinedServerAt,
        messageHistory: borderlineUser2.recentMessage ? [borderlineUser2.recentMessage] : [],
      });

      expect(result.result).toBe('OK');
    });
  });
});
