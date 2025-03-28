import { injectable } from 'inversify';

/**
 * Interface for the heuristic-based spam detection service
 */
export interface IHeuristicService {
  /**
   * Analyzes a message for suspicious patterns using rule-based heuristics
   * @param userId The Discord user ID
   * @param content The message content to analyze
   * @param serverId The server ID where the message was sent (optional)
   * @returns Object with result and reasons
   */
  analyzeMessage(
    userId: string,
    content: string,
    serverId?: string
  ): {
    result: 'OK' | 'SUSPICIOUS';
    reasons: string[];
  };

  /**
   * Checks if a message is suspicious based on frequency and keywords
   * @param userId The Discord user ID
   * @param content The message content
   * @returns Whether the message is suspicious
   */
  isMessageSuspicious(userId: string, content: string): boolean;

  /**
   * Checks if the user is sending messages too frequently
   * @param userId The Discord user ID
   * @returns Whether the user has exceeded the frequency threshold
   */
  isFrequencyAboveThreshold(userId: string): boolean;

  /**
   * Checks if content contains suspicious keywords
   * @param content The message content
   * @returns Whether suspicious keywords were detected
   */
  containsSuspiciousKeywords(content: string): boolean;

  /**
   * Clears the message history (mainly for testing)
   */
  clearMessageHistory(): void;
}

/**
 * HeuristicService: Provides basic spam detection using heuristic methods
 * - Message frequency checking (> 5 messages in 10 seconds)
 * - Suspicious keyword detection
 */
@injectable()
export class HeuristicService implements IHeuristicService {
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
   * Analyzes a message with comprehensive heuristics
   * @param userId The Discord user ID
   * @param content The message content to analyze
   * @param serverId The server ID where the message was sent (optional)
   * @returns Object with result and reasons
   */
  public analyzeMessage(
    userId: string,
    content: string,
    // eslint-disable-next-line no-unused-vars
    _serverId?: string
  ): {
    result: 'OK' | 'SUSPICIOUS';
    reasons: string[];
  } {
    const reasons: string[] = [];
    let result: 'OK' | 'SUSPICIOUS' = 'OK';

    // Check message frequency
    if (this.isFrequencyAboveThreshold(userId)) {
      reasons.push('User is sending messages too quickly');
      result = 'SUSPICIOUS';
    }

    // Check for suspicious keywords
    if (this.containsSuspiciousKeywords(content)) {
      reasons.push('Message contains suspicious keywords or patterns');
      result = 'SUSPICIOUS';
    }

    return { result, reasons };
  }

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
