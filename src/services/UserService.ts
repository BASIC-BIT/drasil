import { User, ServerMember } from '../repositories/types';
import { UserRepository } from '../repositories/UserRepository';
import { ServerMemberRepository } from '../repositories/ServerMemberRepository';

/**
 * Service for managing users and their server memberships
 */
export class UserService {
  constructor(
    private userRepository: UserRepository,
    private serverMemberRepository: ServerMemberRepository
  ) {}

  /**
   * Get or create a user by Discord ID
   * @param discordId The Discord user ID
   * @param username Optional Discord username
   * @returns The user
   */
  async getOrCreateUser(discordId: string, username?: string): Promise<User> {
    const user = await this.userRepository.findByDiscordId(discordId);
    if (user) {
      // Update username if provided and different
      if (username && username !== user.username) {
        return await this.userRepository.upsertByDiscordId(discordId, { username });
      }
      return user;
    }

    // Create new user
    return await this.userRepository.upsertByDiscordId(discordId, {
      username,
      global_reputation_score: 0.0,
      account_created_at: new Date().toISOString(),
    });
  }

  /**
   * Get or create a server member
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param joinDate Optional join date
   * @returns The server member
   */
  async getOrCreateMember(
    serverId: string,
    userId: string,
    joinDate?: string
  ): Promise<ServerMember> {
    const member = await this.serverMemberRepository.findByServerAndUser(serverId, userId);
    if (member) {
      return member;
    }

    // Create new member
    return await this.serverMemberRepository.upsertMember(serverId, userId, {
      join_date: joinDate || new Date().toISOString(),
      reputation_score: 0.0,
      message_count: 0,
    });
  }

  /**
   * Update a user's reputation in a server and potentially their global score
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param serverScore The new server-specific reputation score
   */
  async updateUserReputation(serverId: string, userId: string, serverScore: number): Promise<void> {
    // Update server-specific score
    await this.serverMemberRepository.updateReputationScore(serverId, userId, serverScore);

    // Get all server scores for this user to calculate global score
    const user = await this.userRepository.findById(userId);
    if (!user) return;

    // Find all server memberships
    const memberships = await this.serverMemberRepository.findMany({ user_id: userId });
    if (memberships.length === 0) return;

    // Calculate global score as weighted average of server scores
    const totalScore = memberships.reduce((sum, member) => sum + (member.reputation_score || 0), 0);
    const globalScore = totalScore / memberships.length;

    // Update global reputation score
    await this.userRepository.updateGlobalReputationScore(user.discord_id, globalScore);
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
    await this.getOrCreateUser(discordId, username);

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
    return await this.userRepository.updateMetadata(discordId, metadata);
  }

  /**
   * Find users with low reputation scores
   * @param threshold The reputation score threshold
   * @returns Array of users below the threshold
   */
  async findLowReputationUsers(threshold: number): Promise<User[]> {
    return await this.userRepository.findUsersWithLowReputation(threshold);
  }
}
