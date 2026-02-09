import { inject, injectable } from 'inversify';
import { globalConfig } from '../config/GlobalConfig';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';

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
   * @param serverId The server ID (optional)
   * @returns Whether the message is suspicious
   */
  isMessageSuspicious(userId: string, content: string, serverId?: string): boolean;

  /**
   * Checks if the user is sending messages too frequently
   * @param userId The Discord user ID
   * @returns Whether the user has exceeded the frequency threshold
   */
  isFrequencyAboveThreshold(userId: string, serverId?: string): boolean;

  /**
   * Checks if content contains suspicious keywords
   * @param content The message content
   * @returns Whether suspicious keywords were detected
   */
  containsSuspiciousKeywords(content: string, serverId?: string): boolean;

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
  private configService: IConfigService;

  // Store message timestamps by user ID
  private userMessages: Map<string, number[]> = new Map();

  constructor(@inject(TYPES.ConfigService) configService: IConfigService) {
    this.configService = configService;
  }

  private getUserKey(userId: string, serverId?: string): string {
    return serverId ? `${serverId}:${userId}` : userId;
  }

  private getServerHeuristicSettings(serverId?: string): {
    messageThreshold: number;
    timeWindowMs: number;
    suspiciousKeywords: string[];
  } {
    const globalSettings = globalConfig.getSettings();
    const defaultThreshold = globalSettings.defaultServerSettings.messageThreshold;
    const defaultTimeframeSeconds = globalSettings.defaultServerSettings.messageTimeframe;
    const defaultKeywords = globalSettings.defaultSuspiciousKeywords;

    const server = serverId ? this.configService.getCachedServerConfig(serverId) : undefined;
    const settings = server?.settings;

    const thresholdRaw = settings?.message_threshold;
    const messageThreshold =
      typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw) && thresholdRaw > 0
        ? Math.floor(thresholdRaw)
        : defaultThreshold;

    const timeframeRaw = settings?.message_timeframe;
    const timeframeSeconds =
      typeof timeframeRaw === 'number' && Number.isFinite(timeframeRaw) && timeframeRaw > 0
        ? timeframeRaw
        : defaultTimeframeSeconds;
    const timeWindowMs = timeframeSeconds * 1000;

    const keywordsRaw = settings?.suspicious_keywords;
    const suspiciousKeywords = Array.isArray(keywordsRaw)
      ? keywordsRaw
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : defaultKeywords;

    return { messageThreshold, timeWindowMs, suspiciousKeywords };
  }

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
    serverId?: string
  ): {
    result: 'OK' | 'SUSPICIOUS';
    reasons: string[];
  } {
    const reasons: string[] = [];
    let result: 'OK' | 'SUSPICIOUS' = 'OK';

    // Check message frequency
    if (this.isFrequencyAboveThreshold(userId, serverId)) {
      reasons.push('User is sending messages too quickly');
      result = 'SUSPICIOUS';
    }

    // Check for suspicious keywords
    if (this.containsSuspiciousKeywords(content, serverId)) {
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
  public isMessageSuspicious(userId: string, content: string, serverId?: string): boolean {
    return (
      this.isFrequencyAboveThreshold(userId, serverId) ||
      this.containsSuspiciousKeywords(content, serverId)
    );
  }

  /**
   * Records a new message from a user and checks if they've exceeded the rate limit
   *
   * @param userId The Discord user ID
   * @returns true if user has exceeded message frequency threshold
   */
  public isFrequencyAboveThreshold(userId: string, serverId?: string): boolean {
    const now = Date.now();
    const { messageThreshold, timeWindowMs } = this.getServerHeuristicSettings(serverId);
    const userKey = this.getUserKey(userId, serverId);
    const userMessageTimes = this.userMessages.get(userKey) || [];

    // Add current message timestamp
    userMessageTimes.push(now);

    // Remove messages older than the time window
    const recentMessages = userMessageTimes.filter((timestamp) => timestamp > now - timeWindowMs);

    // Update the stored messages
    this.userMessages.set(userKey, recentMessages);

    // Check if the number of recent messages exceeds the threshold
    return recentMessages.length > messageThreshold;
  }

  /**
   * Checks if a message contains any suspicious keywords
   *
   * @param content The message content
   * @returns true if suspicious keywords are found
   */
  public containsSuspiciousKeywords(content: string, serverId?: string): boolean {
    const { suspiciousKeywords } = this.getServerHeuristicSettings(serverId);
    if (suspiciousKeywords.length === 0) {
      return false;
    }

    const normalizedContent = content.toLowerCase();

    return suspiciousKeywords.some((keyword) => normalizedContent.includes(keyword.toLowerCase()));
  }

  /**
   * Clears the message history for testing purposes
   */
  public clearMessageHistory(): void {
    this.userMessages.clear();
  }
}
