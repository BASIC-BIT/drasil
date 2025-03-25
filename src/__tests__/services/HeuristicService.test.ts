import { HeuristicService } from '../../services/HeuristicService';

describe('HeuristicService', () => {
  let heuristicService: HeuristicService;

  beforeEach(() => {
    heuristicService = new HeuristicService();
    heuristicService.clearMessageHistory(); // Clear history before each test
  });

  describe('isFrequencyAboveThreshold', () => {
    it('should not flag users sending messages at normal rate', () => {
      const userId = '123456789';

      // Send 3 messages (below threshold)
      heuristicService.isFrequencyAboveThreshold(userId);
      heuristicService.isFrequencyAboveThreshold(userId);
      const result = heuristicService.isFrequencyAboveThreshold(userId);

      expect(result).toBe(false);
    });

    it('should flag users exceeding message frequency threshold', () => {
      const userId = '123456789';

      // Send 6 messages (above threshold of 5)
      for (let i = 0; i < 5; i++) {
        heuristicService.isFrequencyAboveThreshold(userId);
      }
      const result = heuristicService.isFrequencyAboveThreshold(userId);

      expect(result).toBe(true);
    });

    it('should not count messages outside the time window', async () => {
      const userId = '123456789';

      // Mock Date.now to control time
      const originalNow = Date.now;
      const startTime = 1000000;
      let currentTime = startTime;

      Date.now = jest.fn(() => currentTime);

      // Send 5 messages (at threshold)
      for (let i = 0; i < 5; i++) {
        heuristicService.isFrequencyAboveThreshold(userId);
      }

      // Advance time past the window (10 seconds)
      currentTime = startTime + 11000;

      // Send another message - should not be flagged since previous ones are outside window
      const result = heuristicService.isFrequencyAboveThreshold(userId);

      // Restore original Date.now
      Date.now = originalNow;

      expect(result).toBe(false);
    });
  });

  describe('containsSuspiciousKeywords', () => {
    it('should not flag normal messages', () => {
      const normalMessage = 'Hello, how are you doing today?';
      const result = heuristicService.containsSuspiciousKeywords(normalMessage);
      expect(result).toBe(false);
    });

    it('should flag messages with suspicious keywords', () => {
      const suspiciousMessages = [
        'Check out this free discord nitro!',
        'I have a nitro scam to share with you',
        'Get your free robux by clicking here',
        'Claim your prize now!',
      ];

      suspiciousMessages.forEach((message) => {
        const result = heuristicService.containsSuspiciousKeywords(message);
        expect(result).toBe(true);
      });
    });

    it('should detect keywords regardless of case', () => {
      const mixedCaseMessage = 'FREE DISCORD NITRO available now';
      const result = heuristicService.containsSuspiciousKeywords(mixedCaseMessage);
      expect(result).toBe(true);
    });
  });

  describe('isMessageSuspicious', () => {
    it('should return true if message frequency is too high', () => {
      const userId = '123456789';
      const normalMessage = 'This is a normal message';

      // Send 5 messages (at threshold)
      for (let i = 0; i < 5; i++) {
        heuristicService.isFrequencyAboveThreshold(userId);
      }

      const result = heuristicService.isMessageSuspicious(userId, normalMessage);
      expect(result).toBe(true);
    });

    it('should return true if message contains suspicious keywords', () => {
      const userId = '123456789';
      const suspiciousMessage = 'Get your free discord nitro here';

      const result = heuristicService.isMessageSuspicious(userId, suspiciousMessage);
      expect(result).toBe(true);
    });

    it('should return false for normal messages at normal frequency', () => {
      const userId = '123456789';
      const normalMessage = 'This is a normal message';

      const result = heuristicService.isMessageSuspicious(userId, normalMessage);
      expect(result).toBe(false);
    });
  });
});
