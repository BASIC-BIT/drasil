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
import { IUserRepository } from '../repositories/UserRepository'; // Added
import { IServerRepository } from '../repositories/ServerRepository'; // Added
import { TYPES } from '../di/symbols';
import { meetsConfidenceLevel } from '../utils/confidence';
import { DetectionType } from '../repositories/types';

export interface DetectionResult {
  label: 'OK' | 'SUSPICIOUS';
  confidence: number;
  reasons: string[];
  triggerSource: DetectionType;
  triggerContent: string;
  profileData?: UserProfileData;
  detectionEventId?: string;
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
    serverId: string, // Added serverId
    userId: string, // Added userId
    profileData: UserProfileData
  ): Promise<DetectionResult>;
}

/**
 * DetectionOrchestrator - Handles incoming events, deciding if they're spam
 */
@injectable()
export class DetectionOrchestrator implements IDetectionOrchestrator {
  private heuristicService: IHeuristicService;
  private gptService: IGPTService;
  private detectionEventsRepository: IDetectionEventsRepository;
  private userRepository: IUserRepository; // Added
  private serverRepository: IServerRepository; // Added

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
    @inject(TYPES.UserRepository) userRepository: IUserRepository, // Added
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository // Added
  ) {
    this.heuristicService = heuristicService;
    this.gptService = gptService;
    this.detectionEventsRepository = detectionEventsRepository;
    this.userRepository = userRepository; // Added
    this.serverRepository = serverRepository; // Added
  }
  /**
   * Ensures user and server entities exist in the database.
   * Necessary before creating a DetectionEvent due to foreign key constraints.
   */
  private async ensureEntitiesExist(
    serverId: string,
    userId: string,
    username?: string
  ): Promise<void> {
    try {
      // Ensure server exists
      await this.serverRepository.getOrCreateServer(serverId);
      // Ensure user exists
      await this.userRepository.getOrCreateUser(userId, username);
      // Note: ServerMember is handled by SecurityActionService later if needed
    } catch (error) {
      console.error('DetectionOrchestrator: Failed to ensure entities exist:', error);
      // Decide if we should throw or just log. Throwing might be safer.
      throw new Error('Failed to ensure prerequisite entities exist for detection event.');
    }
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
    profileData: UserProfileData
  ): Promise<DetectionResult> {
    try {
      // Add outer try block
      // Ensure server and user exist before proceeding
      await this.ensureEntitiesExist(serverId, userId, profileData.username);

      // First, check recent detection history
      const recentEvents = await this.detectionEventsRepository.findByServerAndUser(
        serverId,
        userId
      );
      const recentSuspiciousEvents = recentEvents.filter((event) =>
        meetsConfidenceLevel(event.confidence, 'High')
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
      const isNewAccount = profileData.accountCreatedAt
        ? this.isNewAccount(profileData.accountCreatedAt)
        : false;

      const isNewServerMember = profileData.joinedServerAt
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

      // TODO: We update this inline here but don't update the database? Is this a problem?
      profileData.recentMessages = [...profileData.recentMessages, content];

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

      if (shouldUseGPT) {
        // Use the analyzeProfile method that conforms to the IGPTService interface
        const gptAnalysis = await this.gptService.analyzeProfile(profileData);

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
          reasons: reasons,
          triggerSource: DetectionType.SUSPICIOUS_CONTENT,
          triggerContent: content,
          profileData: profileData,
        };
      } else {
        result = {
          label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
          confidence: Math.abs(suspicionScore - 0.5) * 2,
          reasons: reasons,
          triggerSource: DetectionType.SUSPICIOUS_CONTENT,
          triggerContent: content,
        };
      }

      // Create the detection event record
      const createdEvent = await this.detectionEventsRepository.create({
        server_id: serverId,
        user_id: userId,
        detection_type: result.triggerSource,
        confidence: result.confidence,
        reasons: result.reasons,
        detected_at: new Date(),
        // message_id and channel_id are not needed here; context is available later via event payload
        metadata: { content: content }, // Store original content
      });

      result.detectionEventId = createdEvent.id; // Add the event ID to the result
      return result;
    } catch (error) {
      // Add outer catch block
      console.error(
        `[DEBUG DetectionOrchestrator] detectMessage - ERROR for user ${userId}:`,
        error
      );
      // Rethrow or handle appropriately - rethrowing ensures the caller knows about the failure
      throw error;
    }
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
    serverId: string, // Added serverId
    userId: string, // Added userId
    profileData: UserProfileData
  ): Promise<DetectionResult> {
    try {
      // Add outer try block
      // Ensure server and user exist before proceeding
      await this.ensureEntitiesExist(serverId, userId, profileData.username); // Use params

      // Use the analyzeProfile method from the interface
      const gptAnalysis = await this.gptService.analyzeProfile(profileData);

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

      // Assign initial result to a variable
      const initialResult: DetectionResult = {
        label: suspicionScore >= 0.5 ? 'SUSPICIOUS' : 'OK',
        confidence: Math.abs(suspicionScore - 0.5) * 2,
        reasons: reasons,
        triggerSource: DetectionType.NEW_ACCOUNT,
        triggerContent: 'Server Join',
        profileData: profileData,
      };

      // Create the detection event record using the correct variables
      const createdEvent = await this.detectionEventsRepository.create({
        server_id: serverId, // Use param
        user_id: userId, // Use param
        detection_type: initialResult.triggerSource,
        confidence: initialResult.confidence,
        reasons: initialResult.reasons,
        detected_at: new Date(),
        // No message_id or channel_id for join events
        metadata: { join: true }, // Indicate this was a join event
      });

      initialResult.detectionEventId = createdEvent.id; // Add the event ID to the result
      return initialResult; // Return the modified result
    } catch (error) {
      // Add outer catch block
      console.error(
        `[DEBUG DetectionOrchestrator] detectNewJoin - ERROR for user ${userId}:`,
        error
      );
      // Rethrow or handle appropriately
      throw error;
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
