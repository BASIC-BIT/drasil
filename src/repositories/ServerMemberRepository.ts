import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, verification_status } from '@prisma/client';
import { ServerMember, VerificationStatus } from './types'; // Import VerificationStatus enum
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError

/**
 * Interface for the ServerMemberRepository (Remains the same)
 */
export interface IServerMemberRepository {
  findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null>;
  upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember>;
  findByServer(serverId: string): Promise<ServerMember[]>;
  findByUser(userId: string): Promise<ServerMember[]>;
  findRestrictedMembers(serverId: string): Promise<ServerMember[]>;
  updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null>;
  updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean,
    verificationStatus: verification_status, // Use Prisma enum type
    reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null>;
  incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null>;
  getOrCreateMember(serverId: string, userId: string, joinDate?: Date): Promise<ServerMember>; // Use Date for joinDate
}

/**
 * Repository for managing server members (users in specific servers) using Prisma
 */
@injectable()
export class ServerMemberRepository implements IServerMemberRepository {
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
   * Find a server member by server ID (guild_id) and user ID (discord_id)
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const member = await this.prisma.server_members.findUnique({
        where: {
          server_id_user_id: {
            // Use the composite key defined in schema.prisma (@@id([server_id, user_id]))
            server_id: serverId,
            user_id: userId,
          },
        },
      });
      return member as ServerMember | null; // Cast needed if ServerMember type differs slightly
    } catch (error) {
      this.handleError(error, 'findByServerAndUser');
    }
  }

  /**
   * Create or update a server member
   */
  async upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember> {
    try {
      const memberData = {
        server_id: serverId,
        user_id: userId,
        join_date: data.join_date,
        reputation_score: data.reputation_score,
        is_restricted: data.is_restricted,
        last_verified_at: data.last_verified_at,
        last_message_at: data.last_message_at,
        message_count: data.message_count,
        verification_status: data.verification_status,
        last_status_change: data.last_status_change,
        created_by: data.created_by,
        updated_by: data.updated_by,
      };

      const upserted = await this.prisma.server_members.upsert({
        where: {
          server_id_user_id: {
            server_id: serverId,
            user_id: userId,
          },
        },
        create: {
          ...memberData,
          // Ensure required fields for create are present
          server_id: serverId,
          user_id: userId,
        },
        update: {
          ...memberData,
        },
      });

      return upserted as ServerMember; // Cast needed if ServerMember type differs slightly
    } catch (error) {
      this.handleError(error, 'upsertMember');
    }
  }

  /**
   * Find all members in a server
   */
  async findByServer(serverId: string): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: { server_id: serverId },
      });
      return (members as ServerMember[]) || []; // Cast needed if ServerMember type differs slightly
    } catch (error) {
      this.handleError(error, 'findByServer');
    }
  }

  /**
   * Find all memberships for a specific user across all servers
   */
  async findByUser(userId: string): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: { user_id: userId },
      });
      return (members as ServerMember[]) || []; // Cast needed if ServerMember type differs slightly
    } catch (error) {
      this.handleError(error, 'findByUser');
    }
  }

  /**
   * Find all restricted members in a server
   */
  async findRestrictedMembers(serverId: string): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: {
          server_id: serverId,
          is_restricted: true,
        },
      });
      return (members as ServerMember[]) || []; // Cast needed if ServerMember type differs slightly
    } catch (error) {
      this.handleError(error, 'findRestrictedMembers');
    }
  }

  /**
   * Update a member's reputation score
   */
  async updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null> {
    try {
      const updatedMember = await this.prisma.server_members.update({
        where: {
          server_id_user_id: {
            server_id: serverId,
            user_id: userId,
          },
        },
        data: { reputation_score: score },
      });
      return updatedMember as ServerMember | null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(
          `Attempted to update reputation for non-existent member: Server ${serverId}, User ${userId}`
        );
        return null;
      }
      this.handleError(error, 'updateReputationScore');
    }
  }

  /**
   * Update member's restriction status
   */
  async updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean,
    verificationStatus: verification_status, // Use Prisma enum type
    reason?: string, // Note: restriction_reason field doesn't exist in schema.prisma
    moderatorId?: string
  ): Promise<ServerMember | null> {
    try {
      const now = new Date();
      const updateData: Prisma.server_membersUpdateInput = {
        is_restricted: isRestricted,
        verification_status: verificationStatus,
        last_status_change: now,
        // restriction_reason: reason, // Field missing in schema
        updated_by: moderatorId,
      };

      const updatedMember = await this.prisma.server_members.update({
        where: {
          server_id_user_id: {
            server_id: serverId,
            user_id: userId,
          },
        },
        data: updateData,
      });
      return updatedMember as ServerMember | null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(
          `Attempted to update restriction status for non-existent member: Server ${serverId}, User ${userId}`
        );
        return null;
      }
      this.handleError(error, 'updateRestrictionStatus');
    }
  }

  /**
   * Increment a member's message count and update last_message_at timestamp
   */
  async incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      // Replace RPC call with Prisma update using atomic increment
      const updatedMember = await this.prisma.server_members.update({
        where: {
          server_id_user_id: {
            server_id: serverId,
            user_id: userId,
          },
        },
        data: {
          message_count: {
            increment: 1,
          },
          last_message_at: new Date(),
        },
      });
      return updatedMember as ServerMember | null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(
          `Attempted to increment message count for non-existent member: Server ${serverId}, User ${userId}`
        );
        return null;
      }
      this.handleError(error, 'incrementMessageCount');
    }
  }

  /**
   * Get an existing server member or create a new one
   */
  async getOrCreateMember(
    serverId: string,
    userId: string,
    joinDate?: Date
  ): Promise<ServerMember> {
    // Remove unnecessary try/catch as called methods handle errors
    const member = await this.findByServerAndUser(serverId, userId);

    if (member) {
      // Optionally update join_date if provided and different
      if (joinDate && member.join_date?.getTime() !== joinDate.getTime()) {
        return await this.upsertMember(serverId, userId, { join_date: joinDate });
      }
      return member;
    }

    // Create new member
    return await this.upsertMember(serverId, userId, {
      join_date: joinDate || new Date(),
      message_count: 0,
      is_restricted: false,
      reputation_score: 0, // Default neutral score (matches schema default)
      verification_status: VerificationStatus.PENDING, // Use enum member
    });
    // Errors from findByServerAndUser or upsertMember are already handled internally
  }
}
