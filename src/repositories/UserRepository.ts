import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient } from '@prisma/client'; // Import PrismaClient and generated types
import { User } from './types'; // Keep existing domain types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError

/**
 * Interface for UserRepository (Remains the same)
 */
export interface IUserRepository {
  findById(id: string): Promise<User | null>; // Note: ID in DB is discord_id (string), not UUID
  findByDiscordId(discordId: string): Promise<User | null>;
  upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User>;
  updateReputationScore(discordId: string, score: number): Promise<User | null>;
  findByReputationBelow(threshold: number): Promise<User[]>;
  incrementSuspiciousServerCount(discordId: string): Promise<User | null>;
  decrementSuspiciousServerCount(discordId: string): Promise<User | null>;
  setFirstFlagged(discordId: string, timestamp?: string): Promise<User | null>;
  findUsersFlaggedInMultipleServers(threshold?: number): Promise<User[]>;
  getOrCreateUser(discordId: string, username?: string, accountCreatedAt?: Date): Promise<User>;
}

/**
 * Repository for managing user data using Prisma
 */
@injectable()
export class UserRepository implements IUserRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  /**
   * Handle errors from Prisma operations
   */
  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    } else if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    } else {
      throw new RepositoryError(`Unknown error during ${operation}`, error);
    }
  }

  /**
   * Find a user by ID (which is the discord_id)
   */
  async findById(id: string): Promise<User | null> {
    // In this schema, the primary ID is discord_id
    return this.findByDiscordId(id);
  }

  /**
   * Find a user by Discord ID
   */
  async findByDiscordId(discordId: string): Promise<User | null> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { discord_id: discordId },
      });
      return user as User | null; // Cast needed if User type differs slightly
    } catch (error) {
      this.handleError(error, 'findByDiscordId');
    }
  }

  /**
   * Create or update a user
   */
  async upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User> {
    try {
      const userData = {
        discord_id: discordId,
        username: data.username,
        global_reputation_score: data.global_reputation_score,
        account_created_at: data.account_created_at,
        suspicious_server_count: data.suspicious_server_count,
        first_flagged_at: data.first_flagged_at,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        // created_at is handled by default
        updated_at: new Date(),
      };

      const upserted = await this.prisma.users.upsert({
        where: { discord_id: discordId },
        create: {
          ...userData,
          // Ensure required fields for create are present
          discord_id: discordId,
          // created_at will use the database default
        },
        update: {
          ...userData,
          // Do not overwrite created_at on update
          created_at: undefined,
        },
      });

      return upserted as User; // Cast needed if User type differs slightly
    } catch (error) {
      this.handleError(error, 'upsertByDiscordId');
    }
  }

  /**
   * Update a user's global reputation score
   */
  async updateReputationScore(discordId: string, score: number): Promise<User | null> {
    try {
      const updatedUser = await this.prisma.users.update({
        where: { discord_id: discordId },
        data: {
          global_reputation_score: score,
          updated_at: new Date(),
        },
      });
      return updatedUser as User | null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update reputation for non-existent user: ${discordId}`);
        return null;
      }
      this.handleError(error, 'updateReputationScore');
    }
  }

  /**
   * Get all users with reputation scores below a threshold
   */
  async findByReputationBelow(threshold: number): Promise<User[]> {
    try {
      const users = await this.prisma.users.findMany({
        where: {
          global_reputation_score: {
            lt: threshold,
          },
        },
      });
      return (users as User[]) || []; // Cast needed if User type differs slightly
    } catch (error) {
      this.handleError(error, 'findByReputationBelow');
    }
  }

  /**
   * Increment the number of servers where a user is flagged as suspicious
   */
  async incrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    try {
      // Revert to fetch-then-update due to issues with atomic ops on nullable fields
      const user = await this.findByDiscordId(discordId);
      if (!user) return null;

      const currentCount = user.suspicious_server_count ?? 0; // Use ?? 0 for safety
      const newCount = currentCount + 1;

      const updatedUser = await this.prisma.users.update({
        where: { discord_id: discordId },
        data: {
          suspicious_server_count: newCount,
          updated_at: new Date(),
        },
      });
      return updatedUser as User | null; // Cast needed if User type differs slightly
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to increment flag count for non-existent user: ${discordId}`);
        return null;
      }
      this.handleError(error, 'incrementSuspiciousServerCount');
    }
  }

  /**
   * Decrement the number of servers where a user is flagged as suspicious
   */
  async decrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    try {
      // Revert to fetch-then-update due to issues with atomic ops on nullable fields
      const user = await this.findByDiscordId(discordId);
      if (!user) return null;

      const currentCount = user.suspicious_server_count ?? 0; // Use ?? 0 for safety
      const newCount = Math.max(0, currentCount - 1); // Ensure count doesn't go below 0

      // Only update if the count actually changed
      if (newCount === currentCount) {
        return user;
      }

      const updatedUser = await this.prisma.users.update({
        where: { discord_id: discordId },
        data: {
          suspicious_server_count: newCount,
          updated_at: new Date(),
        },
      });
      return updatedUser as User | null; // Cast needed if User type differs slightly
    } catch (error) {
      // P2025 is handled by the initial findByDiscordId check
      this.handleError(error, 'decrementSuspiciousServerCount');
    }
  }

  /**
   * Mark a user as first flagged
   */
  async setFirstFlagged(discordId: string, timestamp?: string): Promise<User | null> {
    try {
      // Revert to fetch-then-update to avoid type issues with updateMany/where on nullable field
      const user = await this.findByDiscordId(discordId);
      if (!user) {
        console.warn(`Attempted to set first flagged for non-existent user: ${discordId}`);
        return null;
      }

      // Only update if first_flagged_at is not already set
      if (user.first_flagged_at) {
        return user; // Already flagged
      }

      const flaggedTime = timestamp ? new Date(timestamp) : new Date();
      const updatedUser = await this.prisma.users.update({
        where: { discord_id: discordId },
        data: {
          first_flagged_at: flaggedTime,
          updated_at: new Date(),
        },
      });
      return updatedUser as User | null; // Cast needed if User type differs slightly
    } catch (error) {
      // P2025 is handled by the initial findByDiscordId check
      this.handleError(error, 'setFirstFlagged');
    }
  }

  /**
   * Find users with suspicious activity in multiple servers
   */
  async findUsersFlaggedInMultipleServers(threshold: number = 2): Promise<User[]> {
    try {
      const users = await this.prisma.users.findMany({
        where: {
          // Ensure correct filtering on nullable Int, considering default 0
          suspicious_server_count: {
            gte: threshold,
          },
        },
      });
      return (users as User[]) || []; // Cast needed if User type differs slightly
    } catch (error) {
      this.handleError(error, 'findUsersFlaggedInMultipleServers');
    }
  }

  /**
   * Get an existing user by Discord ID or create a new one
   */
  async getOrCreateUser(
    discordId: string,
    username?: string,
    accountCreatedAt?: Date
  ): Promise<User> {
    try {
      const user = await this.prisma.users.findUnique({
        where: { discord_id: discordId },
      });

      if (user) {
        // Update username or account_created_at if changed/provided
        const updateData: Partial<Prisma.usersUpdateInput> = {};
        if (username && user.username !== username) {
          updateData.username = username;
        }
        if (accountCreatedAt && user.account_created_at?.getTime() !== accountCreatedAt.getTime()) {
          updateData.account_created_at = accountCreatedAt;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updated_at = new Date();
          const updatedUser = await this.prisma.users.update({
            where: { discord_id: discordId },
            data: updateData,
          });
          return updatedUser as User;
        }
        return user as User;
      } else {
        // Create new user
        const newUser = await this.prisma.users.create({
          data: {
            discord_id: discordId,
            username: username || 'Unknown User',
            global_reputation_score: 100, // Default reputation score
            account_created_at: accountCreatedAt,
            // created_at and updated_at handled by default/update trigger
          },
        });
        return newUser as User;
      }
    } catch (error) {
      this.handleError(error, 'getOrCreateUser');
    }
  }
}
