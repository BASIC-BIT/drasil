import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { DetectionResult } from './DetectionOrchestrator';

export interface IUserReputationService {
  /**
   * Handle the implications of a detection result on a user's reputation and status
   * - Updates reputation scores for both global and server-specific contexts
   * - Assumes all required entities already exist in the database
   *
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param result The detection result
   */
  updateReputationScores(serverId: string, userId: string, result: DetectionResult): Promise<void>;
}

@injectable()
export class UserReputationService implements IUserReputationService {
  constructor(
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}
  /**
   * Updates user and server member reputation scores based on the detection result
   */
  public async updateReputationScores(
    serverId: string,
    userId: string,
    result: DetectionResult
  ): Promise<void> {
    try {
      // Update global reputation if result is suspicious with high confidence
      if (result.label === 'SUSPICIOUS' && result.confidence > 0.7) {
        const user = await this.userRepository.findByDiscordId(userId);
        if (user) {
          // Decrement the global reputation score (minimum 0)
          const newScore = Math.max(0, (user.global_reputation_score || 100) - 10);
          await this.userRepository.updateReputationScore(userId, newScore);
        }
      }

      // Update server-specific reputation
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
      console.error('Failed to update reputation scores:', error);
      throw error;
    }
  }
}
