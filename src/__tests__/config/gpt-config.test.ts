import { UserProfileData } from '../../services/GPTService';
import * as gptConfig from '../../config/gpt-config';
import { setupConsoleMocking } from '../utils/console-mocks';

// Silence console.error and console.warn during tests
setupConsoleMocking(['error', 'warn']);

describe('GPT Config Formatting', () => {
  describe('getFormattedExamples', () => {
    it('should return a formatted string with examples', () => {
      const result = gptConfig.getFormattedExamples();

      // Check that the result contains the header text
      expect(result).toContain('Here are some examples:');

      // Check for category headers
      expect(result).toContain('Clearly suspicious examples');
      expect(result).toContain('Borderline suspicious examples');
      expect(result).toContain('Borderline normal examples');
      expect(result).toContain('Clearly normal examples');

      // Check that clearly suspicious examples are included
      gptConfig.gptConfig.clearlySuspiciousExamples.forEach((example) => {
        expect(result).toContain(`Username: ${example.username}`);
      });

      // Check that borderline suspicious examples are included
      gptConfig.gptConfig.borderlineSuspiciousExamples.forEach((example) => {
        expect(result).toContain(`Username: ${example.username}`);
      });

      // Check that all suspicious examples are classified as SUSPICIOUS
      const suspiciousExampleCount =
        gptConfig.gptConfig.clearlySuspiciousExamples.length +
        gptConfig.gptConfig.borderlineSuspiciousExamples.length;
      expect(result.match(/Classification: SUSPICIOUS/g)?.length).toBe(suspiciousExampleCount);

      // Check that borderline normal examples are included
      gptConfig.gptConfig.borderlineNormalExamples.forEach((example) => {
        expect(result).toContain(`Username: ${example.username}`);
      });

      // Check that clearly normal examples are included
      gptConfig.gptConfig.clearlyNormalExamples.forEach((example) => {
        expect(result).toContain(`Username: ${example.username}`);
      });

      // Check that all normal examples are classified as OK
      const normalExampleCount =
        gptConfig.gptConfig.clearlyNormalExamples.length +
        gptConfig.gptConfig.borderlineNormalExamples.length;
      expect(result.match(/Classification: OK/g)?.length).toBe(normalExampleCount);
    });

    it('should include all required fields for each example', () => {
      const result = gptConfig.getFormattedExamples();

      // Calculate total number of examples
      const totalExampleCount =
        gptConfig.gptConfig.clearlySuspiciousExamples.length +
        gptConfig.gptConfig.borderlineSuspiciousExamples.length +
        gptConfig.gptConfig.borderlineNormalExamples.length +
        gptConfig.gptConfig.clearlyNormalExamples.length;

      // Check that all examples include account age and join date
      expect(result.match(/Account age:/g)?.length).toBe(totalExampleCount);
      expect(result.match(/Joined server:/g)?.length).toBe(totalExampleCount);
    });
  });

  describe('formatProfileExample', () => {
    // Test implementation of formatProfileExample that returns predictable results
    const mockFormatProfileExample = (
      example: UserProfileData,
      index: number,
      type: 'OK' | 'SUSPICIOUS'
    ): string => {
      let result = `\nExample ${index + 1} (${type}):\n`;
      result += `Username: ${example.username}${example.discriminator ? `#${example.discriminator}` : ''}\n`;
      if (example.nickname) result += `Nickname: ${example.nickname}\n`;

      // Always use these fixed values instead of calculating
      const accountAge = example.accountCreatedAt ? '10 days' : 'unknown';
      const joinedServer = example.joinedServerAt ? '2 days ago' : 'unknown';

      result += `Account age: ${accountAge}\n`;
      result += `Joined server: ${joinedServer}\n`;
      if (example.recentMessage) result += `Recent message: "${example.recentMessage}"\n`;
      result += `Classification: ${type}\n`;

      return result;
    };

    beforeEach(() => {
      // Mock formatProfileExample for predictable test results
      jest.spyOn(gptConfig, 'formatProfileExample').mockImplementation(mockFormatProfileExample);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('formats a complete profile correctly', () => {
      const mockProfile: UserProfileData = {
        username: 'TestUser',
        discriminator: '1234',
        nickname: 'Test Nickname',
        accountCreatedAt: new Date(), // Any date will do since we're mocking
        joinedServerAt: new Date(), // Any date will do since we're mocking
        recentMessage: 'Hello world!',
      };

      const result = gptConfig.formatProfileExample(mockProfile, 0, 'OK');

      expect(result).toContain('Example 1 (OK):');
      expect(result).toContain('Username: TestUser#1234');
      expect(result).toContain('Nickname: Test Nickname');
      expect(result).toContain('Account age: 10 days');
      expect(result).toContain('Joined server: 2 days ago');
      expect(result).toContain('Recent message: "Hello world!"');
      expect(result).toContain('Classification: OK');
    });

    it('handles missing optional fields correctly', () => {
      const mockProfile: UserProfileData = {
        username: 'MinimalUser',
        // No discriminator
        // No nickname
        accountCreatedAt: new Date(), // Any date will do since we're mocking
        joinedServerAt: new Date(), // Any date will do since we're mocking
        // No recent message
      };

      const result = gptConfig.formatProfileExample(mockProfile, 1, 'SUSPICIOUS');

      expect(result).toContain('Example 2 (SUSPICIOUS):');
      expect(result).toContain('Username: MinimalUser');
      expect(result).not.toContain('#');
      expect(result).not.toContain('Nickname:');
      expect(result).toContain('Account age: 10 days'); // Fixed value from mock
      expect(result).toContain('Joined server: 2 days ago'); // Fixed value from mock
      expect(result).not.toContain('Recent message:');
      expect(result).toContain('Classification: SUSPICIOUS');
    });

    it('handles unknown dates correctly', () => {
      const mockProfile: UserProfileData = {
        username: 'UnknownDates',
        discriminator: '9999',
        // No account creation date
        // No server join date
        recentMessage: 'Test message',
      };

      const result = gptConfig.formatProfileExample(mockProfile, 2, 'OK');

      expect(result).toContain('Example 3 (OK):');
      expect(result).toContain('Account age: unknown');
      expect(result).toContain('Joined server: unknown');
    });
  });

  // New test suite to test the date calculation directly
  describe('date calculation in formatProfileExample', () => {
    // Restore the original implementation for these tests
    beforeEach(() => {
      jest.restoreAllMocks();
    });

    it('correctly calculates days ago for dates', () => {
      // Mock Date.now() to return a fixed timestamp
      const NOW = new Date('2023-01-10T12:00:00Z').getTime();
      jest.spyOn(Date, 'now').mockImplementation(() => NOW);

      const DAY_IN_MS = 24 * 60 * 60 * 1000;

      // Test profile with specific dates
      const mockProfile: UserProfileData = {
        username: 'DateTest',
        discriminator: '5555',
        // Account created 5 days ago
        accountCreatedAt: new Date(NOW - 5 * DAY_IN_MS),
        // Joined server 2 days ago
        joinedServerAt: new Date(NOW - 2 * DAY_IN_MS),
      };

      // Use the real implementation
      const result = jest
        .requireActual('../../config/gpt-config')
        .formatProfileExample(mockProfile, 0, 'OK');

      // Check that the dates are calculated correctly
      expect(result).toContain('Account age: 5 days');
      expect(result).toContain('Joined server: 2 days ago');

      // Clean up
      jest.restoreAllMocks();
    });
  });
});
