/**
 * HeuristicService: Provides basic spam detection using heuristic methods
 * - Message frequency checking (> 5 messages in 10 seconds)
 * - Suspicious keyword detection
 */
export class HeuristicService {
  private readonly MESSAGE_THRESHOLD = 5; // max messages allowed
  private readonly TIME_WINDOW_MS = 10000; // 10 seconds in milliseconds
  private readonly SUSPICIOUS_KEYWORDS = [
    'nitro scam',
    'free discord nitro',
    'steam gift',
    'gift card',
    'click this link',
    'claim your prize',
    'crypto giveaway',
    'airdrop',
    'free robux',
  ];

  // Store message timestamps by user ID
  private userMessages: Map<string, number[]> = new Map();

  /**
   * Checks if a message is suspicious based on:
   * 1. Message frequency (rate limiting)
   * 2. Suspicious keywords
   *
   * @param userId The Discord user ID
   * @param content The message content
   * @returns true if suspicious, false otherwise
   */
  public isMessageSuspicious(userId: string, content: string): boolean {
    return this.isFrequencyAboveThreshold(userId) || this.containsSuspiciousKeywords(content);
  }

  /**
   * Records a new message from a user and checks if they've exceeded the rate limit
   *
   * @param userId The Discord user ID
   * @returns true if user has exceeded message frequency threshold
   */
  public isFrequencyAboveThreshold(userId: string): boolean {
    const now = Date.now();
    const userMessageTimes = this.userMessages.get(userId) || [];

    // Add current message timestamp
    userMessageTimes.push(now);

    // Remove messages older than the time window
    const recentMessages = userMessageTimes.filter(
      (timestamp) => timestamp > now - this.TIME_WINDOW_MS
    );

    // Update the stored messages
    this.userMessages.set(userId, recentMessages);

    // Check if the number of recent messages exceeds the threshold
    return recentMessages.length > this.MESSAGE_THRESHOLD;
  }

  /**
   * Checks if a message contains any suspicious keywords
   *
   * @param content The message content
   * @returns true if suspicious keywords are found
   */
  public containsSuspiciousKeywords(content: string): boolean {
    const normalizedContent = content.toLowerCase();

    return this.SUSPICIOUS_KEYWORDS.some((keyword) =>
      normalizedContent.includes(keyword.toLowerCase())
    );
  }

  /**
   * Clears the message history for testing purposes
   */
  public clearMessageHistory(): void {
    this.userMessages.clear();
  }
}
