/**
 * DetectionOrchestrator: Orchestrates spam detection using both heuristic and GPT-based methods
 * - Calls HeuristicService first for quick, low-cost checks
 * - If borderline or user is new, calls GPTService for more sophisticated analysis
 * - Produces a final label: "OK" or "SUSPICIOUS"
 */
import { HeuristicService } from './HeuristicService';
import { GPTService, UserProfileData } from './GPTService';
import { DetectionEventsRepository } from '../repositories/DetectionEventsRepository';

export interface DetectionResult {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  usedGPT: boolean;
  reasons: string[];
  triggerSource: 'message' | 'join';
  triggerContent: string;
}

export class DetectionOrchestrator {
  private heuristicService: HeuristicService;
  private gptService: GPTService;
  private detectionEventsRepository: DetectionEventsRepository;

  // Threshold to determine when to use GPT (0.3-0.7 is borderline)
  private readonly BORDERLINE_LOWER = 0.3;
  private readonly BORDERLINE_UPPER = 0.7;

  // How many days is considered a "new" account or server member
  private readonly NEW_ACCOUNT_THRESHOLD_DAYS = 7;
  private readonly NEW_SERVER_MEMBER_THRESHOLD_DAYS = 3;

  constructor(
    heuristicService: HeuristicService,
    gptService: GPTService,
    detectionEventsRepository: DetectionEventsRepository
  ) {
    this.heuristicService = heuristicService;
    this.gptService = gptService;
    this.detectionEventsRepository = detectionEventsRepository;
  }

  /**
   * Detects if a message is suspicious using a combination of heuristic and GPT-based checks
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param content The message content
   * @param profileData User profile data for GPT analysis
   * @returns A DetectionResult with the final label and metadata
   */
  public async detectMessage(
    serverId: string,
    userId: string,
    content: string,
    profileData?: UserProfileData
  ): Promise<DetectionResult> {
    // First, check recent detection history
    const recentEvents = await this.detectionEventsRepository.findByServerAndUser(serverId, userId);
    const recentSuspiciousEvents = recentEvents.filter((e) => e.confidence_level === 'High');

    // Calculate initial suspicion score based on heuristics
    let suspicionScore = 0;
    let reasons: string[] = [];

    // If user has recent suspicious events, increase initial suspicion
    if (recentSuspiciousEvents.length > 0) {
      suspicionScore += 0.4; // Start with 40% suspicion
      reasons.push('Recent suspicious activity');
    }

    // Run heuristic checks
    const isSuspiciousFrequency = this.heuristicService.isFrequencyAboveThreshold(userId);
    const hasSuspiciousKeywords = this.heuristicService.containsSuspiciousKeywords(content);

    if (isSuspiciousFrequency) {
      suspicionScore += 0.5;
      reasons.push('High message frequency');
    }

    if (hasSuspiciousKeywords) {
      suspicionScore += 0.6;
      reasons.push('Contains suspicious keywords');
    }

    // Check if user is new (if profile data available)
    const isNewAccount = profileData?.accountCreatedAt
      ? this.isNewAccount(profileData.accountCreatedAt)
      : false;

    const isNewServerMember = profileData?.joinedServerAt
      ? this.isNewServerMember(profileData.joinedServerAt)
      : false;

    if (isNewAccount) {
      suspicionScore += 0.2;
      reasons.push('New Discord account');
    }

    if (isNewServerMember) {
      suspicionScore += 0.1;
      reasons.push('Recently joined server');
    }

    // Determine if we should use GPT
    // Use GPT if:
    // 1. The user is new (either to Discord or to the server) OR
    // 2. The suspicion score is borderline (not clearly OK or clearly SUSPICIOUS)
    const shouldUseGPT =
      (isNewAccount ||
        isNewServerMember ||
        (suspicionScore >= this.BORDERLINE_LOWER && suspicionScore <= this.BORDERLINE_UPPER)) &&
      profileData !== undefined;

    let result: DetectionResult;

    if (shouldUseGPT && profileData) {
      const profileWithMessage = {
        ...profileData,
        recentMessage: content,
      };

      const gptResult = await this.gptService.classifyUserProfile(profileWithMessage);

      if (gptResult === 'SUSPICIOUS') {
        suspicionScore = 0.9;
        reasons.push('GPT analysis flagged as suspicious');
      } else {
        suspicionScore = Math.max(0, suspicionScore - 0.3);
        reasons.push('GPT analysis indicates user is likely legitimate');
      }

      result = {
        label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
        confidence: Math.abs(suspicionScore - 0.5) * 2,
        usedGPT: true,
        reasons: reasons,
        triggerSource: 'message',
        triggerContent: content,
      };
    } else {
      result = {
        label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
        confidence: Math.abs(suspicionScore - 0.5) * 2,
        usedGPT: false,
        reasons: reasons,
        triggerSource: 'message',
        triggerContent: content,
      };
    }

    // Store the detection result
    await this.storeDetectionResult(serverId, userId, result, content);

    return result;
  }

  /**
   * Detects if a new server join is suspicious using GPT-based analysis
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param profileData User profile data for analysis
   * @returns A DetectionResult with the final label and metadata
   */
  public async detectNewJoin(
    serverId: string,
    userId: string,
    profileData: UserProfileData
  ): Promise<DetectionResult> {
    // Always use GPT for new joins
    const gptResult = await this.gptService.classifyUserProfile(profileData);

    // Calculate suspicion score
    let suspicionScore = 0;
    let reasons: string[] = [];

    // Check if account is new
    const isNewAccount = this.isNewAccount(profileData.accountCreatedAt);
    if (isNewAccount) {
      suspicionScore += 0.4;
      reasons.push('New Discord account');
    }

    // Add GPT result
    if (gptResult === 'SUSPICIOUS') {
      suspicionScore += 0.5;
      reasons.push('GPT analysis flagged as suspicious');
    }

    const result: DetectionResult = {
      label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
      confidence: Math.abs(suspicionScore - 0.5) * 2,
      usedGPT: true,
      reasons: reasons,
      triggerSource: 'join',
      triggerContent: '',
    };

    // Store the detection result
    await this.storeDetectionResult(serverId, userId, result);

    return result;
  }

  /**
   * Stores a detection result in the database
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param result The detection result
   * @param messageId Optional message ID for message detections
   */
  private async storeDetectionResult(
    serverId: string,
    userId: string,
    result: DetectionResult,
    messageId?: string
  ): Promise<void> {
    try {
      await this.detectionEventsRepository.create({
        server_id: serverId,
        user_id: userId,
        message_id: messageId,
        detection_type: result.triggerSource === 'message' ? 'MESSAGE' : 'JOIN',
        confidence: result.confidence,
        confidence_level: this.getConfidenceLevel(result.confidence),
        reasons: result.reasons,
        used_gpt: result.usedGPT,
        detected_at: new Date(),
        admin_action: undefined,
        admin_action_by: undefined,
        admin_action_at: undefined,
        metadata: {
          trigger_content: result.triggerContent,
        },
      });
    } catch (error) {
      console.error('Failed to store detection result:', error);
    }
  }

  /**
   * Converts a confidence score to a confidence level
   *
   * @param confidence The confidence score (0-1)
   * @returns The confidence level ('Low', 'Medium', or 'High')
   */
  private getConfidenceLevel(confidence: number): 'Low' | 'Medium' | 'High' {
    if (confidence < 0.3) return 'Low';
    if (confidence < 0.7) return 'Medium';
    return 'High';
  }

  /**
   * Checks if an account is considered "new" based on creation date
   *
   * @param accountCreatedAt The account creation date
   * @returns True if the account is considered new
   */
  private isNewAccount(accountCreatedAt: Date | undefined): boolean {
    if (!accountCreatedAt) return false;
    const daysSinceCreation = Math.floor(
      (Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceCreation <= this.NEW_ACCOUNT_THRESHOLD_DAYS;
  }

  /**
   * Checks if a server member is considered "new" based on join date
   *
   * @param joinedServerAt The server join date
   * @returns True if the member is considered new to the server
   */
  private isNewServerMember(joinedServerAt: Date): boolean {
    const daysSinceJoin = Math.floor(
      (Date.now() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return daysSinceJoin <= this.NEW_SERVER_MEMBER_THRESHOLD_DAYS;
  }
}
