/**
 * DetectionOrchestrator: Orchestrates spam detection using both heuristic and GPT-based methods
 * - Calls HeuristicService first for quick, low-cost checks
 * - If borderline or user is new, calls GPTService for more sophisticated analysis
 * - Produces a final label: "OK" or "SUSPICIOUS"
 */
import { injectable, inject } from 'inversify';
import { IHeuristicService } from './HeuristicService';
import { IGPTService, UserProfileData } from './GPTService';
import { IDetectionEventsRepository } from '../repositories/DetectionEventsRepository';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerRepository } from '../repositories/ServerRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { IUserService } from './UserService';
import { IServerService } from './ServerService';
import { TYPES } from '../di/symbols';

export interface DetectionResult {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  usedGPT: boolean;
  reasons: string[];
  triggerSource: 'message' | 'join';
  triggerContent: string;
  profileData?: UserProfileData;
}

/**
 * Interface for the DetectionOrchestrator service
 */
export interface IDetectionOrchestrator {
  /**
   * Detects if a message is suspicious using a combination of heuristic and GPT-based checks
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param content The message content
   * @param profileData User profile data for GPT analysis
   * @returns A DetectionResult with the final label and metadata
   */
  detectMessage(
    serverId: string,
    userId: string,
    content: string,
    profileData?: UserProfileData
  ): Promise<DetectionResult>;

  /**
   * Detects if a new server join is suspicious using GPT-based analysis
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param profileData User profile data for analysis
   * @returns A DetectionResult with the final label and metadata
   */
  detectNewJoin(
    serverId: string,
    userId: string,
    profileData: UserProfileData
  ): Promise<DetectionResult>;
}

@injectable()
export class DetectionOrchestrator implements IDetectionOrchestrator {
  private heuristicService: IHeuristicService;
  private gptService: IGPTService;
  private detectionEventsRepository: IDetectionEventsRepository;
  private userRepository: IUserRepository;
  private serverRepository: IServerRepository;
  private serverMemberRepository: IServerMemberRepository;
  private userService: IUserService;
  private serverService: IServerService;

  // Threshold to determine when to use GPT (0.3-0.7 is borderline)
  private readonly BORDERLINE_LOWER = 0.3;
  private readonly BORDERLINE_UPPER = 0.7;

  // How many days is considered a "new" account or server member
  private readonly NEW_ACCOUNT_THRESHOLD_DAYS = 7;
  private readonly NEW_SERVER_MEMBER_THRESHOLD_DAYS = 3;

  constructor(
    @inject(TYPES.HeuristicService) heuristicService: IHeuristicService,
    @inject(TYPES.GPTService) gptService: IGPTService,
    @inject(TYPES.DetectionEventsRepository) detectionEventsRepository: IDetectionEventsRepository,
    @inject(TYPES.UserRepository) userRepository: IUserRepository,
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.ServerMemberRepository) serverMemberRepository: IServerMemberRepository,
    @inject(TYPES.UserService) userService: IUserService,
    @inject(TYPES.ServerService) serverService: IServerService
  ) {
    this.heuristicService = heuristicService;
    this.gptService = gptService;
    this.detectionEventsRepository = detectionEventsRepository;
    this.userRepository = userRepository;
    this.serverRepository = serverRepository;
    this.serverMemberRepository = serverMemberRepository;
    this.userService = userService;
    this.serverService = serverService;
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
    const recentSuspiciousEvents = recentEvents.filter(
      (event) => event.confidence_level === 'High'
    );

    // Calculate initial suspicion score based on heuristics
    let suspicionScore = 0;
    let reasons: string[] = [];

    // If user has recent suspicious events, increase initial suspicion
    if (recentSuspiciousEvents.length > 0) {
      suspicionScore += 0.4; // Start with 40% suspicion
      reasons.push('Recent suspicious activity');
    }

    // Run heuristic checks on the message content
    const heuristicResult = this.heuristicService.analyzeMessage(userId, content, serverId);

    if (heuristicResult.result === 'SUSPICIOUS') {
      suspicionScore += 0.5;
      reasons = [...reasons, ...heuristicResult.reasons];
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
      // Use the analyzeProfile method that conforms to the IGPTService interface
      const gptAnalysis = await this.gptService.analyzeProfile({
        userId,
        username: profileData.username,
        accountAge: profileData.accountCreatedAt
          ? Math.floor(
              (Date.now() - profileData.accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
            )
          : undefined,
        joinedServer: profileData.joinedServerAt,
        messageHistory: [
          ...(profileData.recentMessages ? profileData.recentMessages : []),
          content, // Include the current message being analyzed
        ],
      });

      if (gptAnalysis.result === 'SUSPICIOUS') {
        suspicionScore = 0.9;
        reasons = [...reasons, ...gptAnalysis.reasons];
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
        profileData: profileData,
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
    // Use the analyzeProfile method from the interface
    const gptAnalysis = await this.gptService.analyzeProfile({
      userId,
      username: profileData.username,
      accountAge: profileData.accountCreatedAt
        ? Math.floor((Date.now() - profileData.accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24))
        : undefined,
      joinedServer: profileData.joinedServerAt,
    });

    // Calculate suspicion score
    let suspicionScore = 0;
    let reasons: string[] = [...gptAnalysis.reasons];

    // Check if account is new
    const isNewAccount = this.isNewAccount(profileData.accountCreatedAt);
    if (isNewAccount) {
      suspicionScore += 0.4;
      reasons.push('New Discord account');
    }

    // Use the GPT analysis result
    if (gptAnalysis.result === 'SUSPICIOUS') {
      suspicionScore += 0.7;
    }

    const result: DetectionResult = {
      label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
      confidence: Math.abs(suspicionScore - 0.5) * 2,
      usedGPT: true,
      reasons: reasons,
      triggerSource: 'join',
      triggerContent: 'Server Join',
      profileData: profileData,
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
   * @param messageId Optional message ID that triggered the detection
   */
  private async storeDetectionResult(
    serverId: string,
    userId: string,
    result: DetectionResult,
    messageId?: string
  ): Promise<void> {
    try {
      // First, ensure the server exists using the ServerService
      await this.serverService.getOrCreateServer(serverId);

      // Then, ensure the user exists using the UserService
      await this.userService.getOrCreateUser(userId, result.profileData?.username);

      // Ensure server_member record exists using the UserService
      await this.userService.getOrCreateMember(
        serverId,
        userId,
        result.profileData?.joinedServerAt?.toISOString()
      );

      const confidenceLevel = this.getConfidenceLevel(result.confidence);

      // Create the detection event data
      const eventData = {
        server_id: serverId,
        user_id: userId,
        message_id: messageId,
        detection_type: result.triggerSource === 'join' ? 'join' : 'message',
        confidence: result.confidence,
        confidence_level: confidenceLevel,
        reasons: result.reasons,
        used_gpt: result.usedGPT,
        detected_at: new Date().toISOString(),
        metadata: {
          triggerContent: result.triggerContent,
        },
      };

      // Save to detection events repository
      await this.detectionEventsRepository.create(eventData);

      // Update user and server member models
      this.updateUserModels(serverId, userId, result);
    } catch (error) {
      console.error('Failed to store detection result:', error);
    }
  }

  /**
   * Updates user and server member models with detection result
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param result The detection result
   */
  private async updateUserModels(
    serverId: string,
    userId: string,
    result: DetectionResult
  ): Promise<void> {
    try {
      // Update the user's global reputation score if result is suspicious with high confidence
      if (result.label === 'SUSPICIOUS' && result.confidence > 0.7) {
        const user = await this.userRepository.findByDiscordId(userId);
        if (user) {
          // Decrement the global reputation score (minimum 0)
          const newScore = Math.max(0, (user.global_reputation_score || 100) - 10);
          await this.userRepository.updateReputationScore(userId, newScore);
        }
      }

      // Update server member reputation
      const member = await this.serverMemberRepository.findByServerAndUser(serverId, userId);
      if (member) {
        // Adjust reputation score based on result
        let newScore = member.reputation_score || 50;
        if (result.label === 'SUSPICIOUS') {
          newScore = Math.max(0, newScore - result.confidence * 20);
        } else {
          newScore = Math.min(100, newScore + 5);
        }
        await this.serverMemberRepository.updateReputationScore(serverId, userId, newScore);
      }
    } catch (error) {
      console.error('Failed to update user models:', error);
    }
  }

  /**
   * Converts a numeric confidence (0-1) to a level description
   *
   * @param confidence Confidence value between 0 and 1
   * @returns Confidence level as Low, Medium, or High
   */
  private getConfidenceLevel(confidence: number): 'Low' | 'Medium' | 'High' {
    if (confidence < 0.4) {
      return 'Low';
    } else if (confidence < 0.7) {
      return 'Medium';
    } else {
      return 'High';
    }
  }

  /**
   * Determines if a Discord account is considered new
   *
   * @param accountCreatedAt Account creation date
   * @returns Boolean indicating if account is new
   */
  private isNewAccount(accountCreatedAt: Date | undefined): boolean {
    if (!accountCreatedAt) return false;

    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - accountCreatedAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffInDays <= this.NEW_ACCOUNT_THRESHOLD_DAYS;
  }

  /**
   * Determines if a server member is considered new
   *
   * @param joinedServerAt Date when user joined the server
   * @returns Boolean indicating if server member is new
   */
  private isNewServerMember(joinedServerAt: Date): boolean {
    const now = new Date();
    const diffInDays = Math.floor(
      (now.getTime() - joinedServerAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    return diffInDays <= this.NEW_SERVER_MEMBER_THRESHOLD_DAYS;
  }
}
