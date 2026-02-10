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
 *
 * The heuristics are server-configurable (per guild) via cached `Server.settings`,
 * with global defaults as a fallback:
 * - `message_threshold`: max messages allowed in the time window
 * - `message_timeframe`: time window (seconds)
 * - `suspicious_keywords`: substring match list
 */
@injectable()
export class HeuristicService implements IHeuristicService {
  private configService: Pick<IConfigService, 'getCachedServerConfig'>;

  private readonly defaultMessageThreshold: number;
  private readonly defaultTimeWindowMs: number;
  private readonly defaultSuspiciousKeywords: string[];
  private readonly legacyDefaultSuspiciousKeywords = [
    'free nitro',
    'discord nitro',
    'claim your prize',
  ];

  private readonly cleanupIntervalMs = 60_000;
  private lastCleanupAt = 0;

  // Store message timestamps by a per-user key (server-aware when serverId is provided)
  private userMessages: Map<string, number[]> = new Map();

  constructor(
    @inject(TYPES.ConfigService)
    configService: Pick<IConfigService, 'getCachedServerConfig'>
  ) {
    this.configService = configService;

    const globalSettings = globalConfig.getSettings();
    this.defaultMessageThreshold = globalSettings.defaultServerSettings.messageThreshold;
    this.defaultTimeWindowMs = globalSettings.defaultServerSettings.messageTimeframe * 1000;
    this.defaultSuspiciousKeywords = [...globalSettings.defaultSuspiciousKeywords];
  }

  private getUserKey(userId: string, serverId?: string): string {
    return serverId ? `${serverId.length}:${serverId}:${userId.length}:${userId}` : userId;
  }

  private extractServerIdFromUserKey(userKey: string): string | undefined {
    const colonIndex = userKey.indexOf(':');
    if (colonIndex < 0) {
      return undefined;
    }

    const lengthText = userKey.slice(0, colonIndex);
    const serverIdLength = Number.parseInt(lengthText, 10);
    if (!Number.isFinite(serverIdLength) || serverIdLength <= 0) {
      return undefined;
    }

    const serverIdStart = colonIndex + 1;
    const serverIdEnd = serverIdStart + serverIdLength;
    const serverId = userKey.slice(serverIdStart, serverIdEnd);
    if (serverId.length !== serverIdLength) {
      return undefined;
    }

    return serverId;
  }

  private getServerHeuristicSettings(serverId?: string): {
    messageThreshold: number;
    timeWindowMs: number;
    suspiciousKeywords: string[];
  } {
    const server = serverId ? this.configService.getCachedServerConfig(serverId) : undefined;
    const settings = server?.settings;

    const thresholdRaw = settings?.message_threshold;
    const messageThreshold =
      typeof thresholdRaw === 'number' && Number.isFinite(thresholdRaw) && thresholdRaw > 0
        ? Math.floor(thresholdRaw)
        : this.defaultMessageThreshold;

    const timeframeRaw = settings?.message_timeframe;
    const timeframeSeconds =
      typeof timeframeRaw === 'number' && Number.isFinite(timeframeRaw) && timeframeRaw > 0
        ? timeframeRaw
        : this.defaultTimeWindowMs / 1000;
    const timeWindowMs = timeframeSeconds * 1000;

    const keywordsRaw = settings?.suspicious_keywords;
    let suspiciousKeywords: string[];

    if (Array.isArray(keywordsRaw)) {
      const sanitized = keywordsRaw
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0);

      // Migration-friendly behavior: many servers have a persisted copy of the old
      // 3-keyword default list. If so, use the current global defaults to keep the
      // heuristic wide without requiring manual DB edits.
      suspiciousKeywords = this.isLegacyDefaultKeywordList(sanitized)
        ? this.defaultSuspiciousKeywords
        : sanitized;
    } else {
      suspiciousKeywords = this.defaultSuspiciousKeywords;
    }

    return { messageThreshold, timeWindowMs, suspiciousKeywords };
  }

  private isLegacyDefaultKeywordList(keywords: string[]): boolean {
    const normalized = Array.from(new Set(keywords.map((value) => value.toLowerCase())))
      .sort()
      .join('|');
    const legacy = Array.from(
      new Set(this.legacyDefaultSuspiciousKeywords.map((value) => value.toLowerCase()))
    )
      .sort()
      .join('|');
    return normalized.length > 0 && normalized === legacy;
  }

  private maybeCleanupMessageHistory(now: number): void {
    if (now - this.lastCleanupAt < this.cleanupIntervalMs) {
      return;
    }
    this.lastCleanupAt = now;

    const serverTimeWindows = new Map<string, number>();

    for (const [userKey, timestamps] of this.userMessages.entries()) {
      const lastTimestamp = timestamps[timestamps.length - 1];

      const serverId = this.extractServerIdFromUserKey(userKey);
      const timeWindowMs = serverId
        ? (serverTimeWindows.get(serverId) ??
          this.getServerHeuristicSettings(serverId).timeWindowMs)
        : this.defaultTimeWindowMs;
      if (serverId && !serverTimeWindows.has(serverId)) {
        serverTimeWindows.set(serverId, timeWindowMs);
      }

      if (!lastTimestamp || lastTimestamp <= now - timeWindowMs) {
        this.userMessages.delete(userKey);
      }
    }
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

    this.maybeCleanupMessageHistory(now);

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
