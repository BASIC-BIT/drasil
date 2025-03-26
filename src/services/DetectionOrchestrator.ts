/**
 * DetectionOrchestrator: Orchestrates spam detection using both heuristic and GPT-based methods
 * - Calls HeuristicService first for quick, low-cost checks
 * - If borderline or user is new, calls GPTService for more sophisticated analysis
 * - Produces a final label: "OK" or "SUSPICIOUS"
 */
import { HeuristicService } from './HeuristicService';
import { GPTService, UserProfileData } from './GPTService';

export interface DetectionResult {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  usedGPT: boolean;
  reasons: string[];
  triggerSource: 'message' | 'join';
  triggerContent?: string;
}

export class DetectionOrchestrator {
  private heuristicService: HeuristicService;
  private gptService: GPTService;

  // Threshold to determine when to use GPT (0.3-0.7 is borderline)
  private readonly BORDERLINE_LOWER = 0.3;
  private readonly BORDERLINE_UPPER = 0.7;

  // How many days is considered a "new" account or server member
  private readonly NEW_ACCOUNT_THRESHOLD_DAYS = 7;
  private readonly NEW_SERVER_MEMBER_THRESHOLD_DAYS = 3;

  constructor(heuristicService: HeuristicService, gptService: GPTService) {
    this.heuristicService = heuristicService;
    this.gptService = gptService;
  }

  /**
   * Detects if a message is suspicious using a combination of heuristic and GPT-based checks
   *
   * @param userId The Discord user ID
   * @param content The message content
   * @param profileData User profile data for GPT analysis
   * @returns A DetectionResult with the final label and metadata
   */
  public async detectMessage(
    userId: string,
    content: string,
    profileData?: UserProfileData
  ): Promise<DetectionResult> {
    // First, run heuristic checks
    const isSuspiciousFrequency = this.heuristicService.isFrequencyAboveThreshold(userId);
    const hasSuspiciousKeywords = this.heuristicService.containsSuspiciousKeywords(content);

    // Calculate initial suspicion score based on heuristics
    let suspicionScore = 0;
    let reasons: string[] = [];

    if (isSuspiciousFrequency) {
      suspicionScore += 0.5; // +50% suspicious for high message frequency
      reasons.push('High message frequency');
    }

    if (hasSuspiciousKeywords) {
      suspicionScore += 0.6; // +60% suspicious for suspicious keywords
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
      suspicionScore += 0.2; // +20% suspicious for new account
      reasons.push('New Discord account');
    }

    if (isNewServerMember) {
      suspicionScore += 0.1; // +10% suspicious for new server member
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

    // If we should use GPT and have profile data, call GPT
    if (shouldUseGPT && profileData) {
      // Add the message content to the profile data for better context
      const profileWithMessage = {
        ...profileData,
        recentMessage: content,
      };

      // Call GPT to analyze the user
      const gptResult = await this.gptService.classifyUserProfile(profileWithMessage);

      // If GPT says SUSPICIOUS, set high suspicion score
      if (gptResult === 'SUSPICIOUS') {
        suspicionScore = 0.9; // 90% suspicious
        reasons.push('GPT analysis flagged as suspicious');
      } else {
        // If GPT says OK, reduce suspicion but don't eliminate it entirely if there were
        // strong heuristic signals
        suspicionScore = Math.max(0, suspicionScore - 0.3);
        reasons.push('GPT analysis indicates user is likely legitimate');
      }

      // Return the final result with GPT influence
      return {
        label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
        confidence: Math.abs(suspicionScore - 0.5) * 2, // Scale to 0-1 confidence
        usedGPT: true,
        reasons: reasons,
        triggerSource: 'message',
        triggerContent: content,
      };
    }

    // If we didn't use GPT, return the result based on heuristics alone
    return {
      label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
      confidence: Math.abs(suspicionScore - 0.5) * 2, // Scale to 0-1 confidence
      usedGPT: false,
      reasons: reasons,
      triggerSource: 'message',
      triggerContent: content,
    };
  }

  /**
   * Detects if a user is suspicious when they join a server
   * Always uses GPT for new joins if profile data is available
   *
   * @param profileData User profile data for GPT analysis
   * @returns A DetectionResult with the final label and metadata
   */
  public async detectNewJoin(profileData: UserProfileData): Promise<DetectionResult> {
    // For new joins, we always want to use GPT if possible
    // But we'll still calculate an initial suspicion score
    let suspicionScore = 0;
    let reasons: string[] = [];

    // Check if user is new to Discord
    const isNewAccount = profileData.accountCreatedAt
      ? this.isNewAccount(profileData.accountCreatedAt)
      : false;

    if (isNewAccount) {
      suspicionScore += 0.3; // +30% suspicious for new account
      reasons.push('New Discord account');
    }

    // Call GPT to analyze the profile
    const gptResult = await this.gptService.classifyUserProfile(profileData);

    // Adjust suspicion score based on GPT result
    if (gptResult === 'SUSPICIOUS') {
      suspicionScore += 0.6; // +60% suspicious from GPT
      reasons.push('GPT analysis flagged as suspicious');
    } else {
      // If GPT says OK, reduce suspicion
      suspicionScore = Math.max(0, suspicionScore - 0.2);
      reasons.push('GPT analysis indicates user is likely legitimate');
    }

    // Return the final result
    return {
      label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
      confidence: Math.abs(suspicionScore - 0.5) * 2, // Scale to 0-1 confidence
      usedGPT: true,
      reasons: reasons,
      triggerSource: 'join',
    };
  }

  /**
   * Checks if an account is considered "new" based on creation date
   *
   * @param accountCreatedAt The account creation date
   * @returns true if the account is newer than the threshold
   */
  private isNewAccount(accountCreatedAt: Date): boolean {
    const accountAgeDays = (Date.now() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    return accountAgeDays < this.NEW_ACCOUNT_THRESHOLD_DAYS;
  }

  /**
   * Checks if a user is a new server member based on join date
   *
   * @param joinedServerAt The server join date
   * @returns true if the user joined more recently than the threshold
   */
  private isNewServerMember(joinedServerAt: Date): boolean {
    const memberAgeDays = (Date.now() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24);
    return memberAgeDays < this.NEW_SERVER_MEMBER_THRESHOLD_DAYS;
  }
}
