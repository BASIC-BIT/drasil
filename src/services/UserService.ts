import { User, ServerMember } from '../repositories/types';
import { IUserRepository } from '../repositories/UserRepository';
import { IServerMemberRepository } from '../repositories/ServerMemberRepository';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';

/**
 * Interface for the UserService
 */
export interface IUserService {
  updateUserReputation(serverId: string, userId: string, serverScore: number): Promise<void>;
  handleUserMessage(
    serverId: string,
    userId: string,
    discordId: string,
    username: string
  ): Promise<void>;
  updateUserRestriction(
    serverId: string,
    userId: string,
    isRestricted: boolean
  ): Promise<ServerMember | null>;
  getRestrictedUsers(serverId: string): Promise<ServerMember[]>;
  updateUserMetadata(discordId: string, metadata: Record<string, unknown>): Promise<User | null>;
  findLowReputationUsers(threshold: number): Promise<User[]>;
}

/**
 * Service for managing users and their relationships with servers
 */
@injectable()
export class UserService implements IUserService {
  constructor(
    @inject(TYPES.UserRepository) private userRepository: IUserRepository,
    @inject(TYPES.ServerMemberRepository) private serverMemberRepository: IServerMemberRepository
  ) {}

  /**
   * Update user reputation score in server and globally
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param serverScore The new server-specific score
   */
  async updateUserReputation(serverId: string, userId: string, serverScore: number): Promise<void> {
    // Update server-specific score
    await this.serverMemberRepository.updateReputationScore(serverId, userId, serverScore);

    // Get all server scores for this user to calculate global score
    const user = await this.userRepository.findByDiscordId(userId);
    if (!user) return;

    // Find all server memberships
    const memberships = await this.serverMemberRepository.findByUser(userId);
    if (memberships.length === 0) return;

    // Calculate global score as weighted average of server scores
    const totalScore = memberships.reduce(
      (sum: number, member: ServerMember) => sum + (member.reputation_score || 0),
      0
    );
    const globalScore = totalScore / memberships.length;

    // Update global reputation score
    await this.userRepository.updateReputationScore(user.discord_id, globalScore);
  }

  /**
   * Handle a user message in a server
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param discordId The Discord user ID
   * @param username The Discord username
   */
  async handleUserMessage(
    serverId: string,
    userId: string,
    discordId: string,
    username: string
  ): Promise<void> {
    // Ensure user exists and username is up to date
    await this.userRepository.getOrCreateUser(discordId, username);

    // Update message count and timestamp
    await this.serverMemberRepository.incrementMessageCount(serverId, userId);
  }

  /**
   * Update a user's restriction status in a server
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param isRestricted Whether the user should be restricted
   * @returns The updated server member
   */
  async updateUserRestriction(
    serverId: string,
    userId: string,
    isRestricted: boolean
  ): Promise<ServerMember | null> {
    return await this.serverMemberRepository.updateRestrictionStatus(
      serverId,
      userId,
      isRestricted
    );
  }

  /**
   * Get all restricted users in a server
   * @param serverId The server UUID
   * @returns Array of restricted server members
   */
  async getRestrictedUsers(serverId: string): Promise<ServerMember[]> {
    return await this.serverMemberRepository.findRestrictedMembers(serverId);
  }

  /**
   * Update user metadata
   * @param discordId The Discord user ID
   * @param metadata The metadata to update
   * @returns The updated user
   */
  async updateUserMetadata(
    discordId: string,
    metadata: Record<string, unknown>
  ): Promise<User | null> {
    // First fetch the current user
    const user = await this.userRepository.findByDiscordId(discordId);
    if (!user) return null;

    // Update the user with the new metadata
    const updatedUser = {
      ...user,
      metadata: {
        ...user.metadata,
        ...metadata,
      },
      updated_at: new Date().toISOString(),
    };

    return await this.userRepository.upsertByDiscordId(discordId, updatedUser);
  }

  /**
   * Find users with low reputation scores
   * @param threshold The reputation score threshold
   * @returns Array of users below the threshold
   */
  async findLowReputationUsers(threshold: number): Promise<User[]> {
    return await this.userRepository.findByReputationBelow(threshold);
  }
}
