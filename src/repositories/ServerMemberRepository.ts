import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, verification_status } from '../db/prisma';
import { ServerMember, VerificationStatus } from './types'; // Import VerificationStatus enum
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError

export interface DiscordMemberPendingStateUpdate {
  member: ServerMember;
  wasPending: boolean;
  isPending: boolean;
  pendingChanged: boolean;
}

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
  findCaseRoleActiveMembers(serverId: string): Promise<ServerMember[]>;
  findLongPendingDiscordMembers(
    serverId: string,
    pendingSinceBefore: Date,
    limit?: number
  ): Promise<ServerMember[]>;
  findLongPendingDiscordMembersNeedingDigest(
    serverId: string,
    pendingSinceBefore: Date,
    limit?: number
  ): Promise<ServerMember[]>;
  markDiscordMemberPendingDigestSent(
    serverId: string,
    userIds: string[],
    sentAt?: Date
  ): Promise<number>;
  updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null>;
  updateCaseRoleStatus(
    serverId: string,
    userId: string,
    caseRoleActive: boolean,
    verificationStatus: verification_status, // Use Prisma enum type
    reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null>;
  incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null>;
  getOrCreateMember(serverId: string, userId: string, joinDate?: Date): Promise<ServerMember>; // Use Date for joinDate
  updateDiscordMemberPendingState(
    serverId: string,
    userId: string,
    pending: boolean,
    observedAt?: Date
  ): Promise<DiscordMemberPendingStateUpdate | null>;
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
        case_role_active: data.case_role_active,
        last_verified_at: data.last_verified_at,
        last_message_at: data.last_message_at,
        message_count: data.message_count,
        verification_status: data.verification_status,
        last_status_change: data.last_status_change,
        discord_member_pending: data.discord_member_pending,
        discord_member_pending_since: data.discord_member_pending_since,
        discord_member_pending_cleared_at: data.discord_member_pending_cleared_at,
        discord_member_pending_last_checked_at: data.discord_member_pending_last_checked_at,
        discord_member_pending_digest_sent_at: data.discord_member_pending_digest_sent_at,
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
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return members as ServerMember[];
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
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return members as ServerMember[];
    } catch (error) {
      this.handleError(error, 'findByUser');
    }
  }

  /**
   * Find all members with the case role active in a server
   */
  async findCaseRoleActiveMembers(serverId: string): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: {
          server_id: serverId,
          case_role_active: true,
        },
      });
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return members as ServerMember[];
    } catch (error) {
      this.handleError(error, 'findCaseRoleActiveMembers');
    }
  }

  async findLongPendingDiscordMembers(
    serverId: string,
    pendingSinceBefore: Date,
    limit = 100
  ): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: {
          server_id: serverId,
          discord_member_pending: true,
          discord_member_pending_since: { lte: pendingSinceBefore },
        },
        orderBy: { discord_member_pending_since: 'asc' },
        take: limit,
      });
      return members as ServerMember[];
    } catch (error) {
      this.handleError(error, 'findLongPendingDiscordMembers');
    }
  }

  async findLongPendingDiscordMembersNeedingDigest(
    serverId: string,
    pendingSinceBefore: Date,
    limit = 25
  ): Promise<ServerMember[]> {
    try {
      const members = await this.prisma.server_members.findMany({
        where: {
          server_id: serverId,
          discord_member_pending: true,
          discord_member_pending_since: { lte: pendingSinceBefore },
          discord_member_pending_digest_sent_at: null,
        },
        orderBy: { discord_member_pending_since: 'asc' },
        take: limit,
      });
      return members as ServerMember[];
    } catch (error) {
      this.handleError(error, 'findLongPendingDiscordMembersNeedingDigest');
    }
  }

  async markDiscordMemberPendingDigestSent(
    serverId: string,
    userIds: string[],
    sentAt: Date = new Date()
  ): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }

    try {
      const result = await this.prisma.server_members.updateMany({
        where: {
          server_id: serverId,
          user_id: { in: userIds },
          discord_member_pending: true,
        },
        data: {
          discord_member_pending_digest_sent_at: sentAt,
          discord_member_pending_last_checked_at: sentAt,
        },
      });
      return result.count;
    } catch (error) {
      this.handleError(error, 'markDiscordMemberPendingDigestSent');
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
   * Update a member's case-role status
   */
  async updateCaseRoleStatus(
    serverId: string,
    userId: string,
    caseRoleActive: boolean,
    verificationStatus: verification_status, // Use Prisma enum type
    reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null> {
    try {
      const now = new Date();
      const updateData: Prisma.server_membersUpdateInput = {
        case_role_active: caseRoleActive,
        verification_status: verificationStatus,
        last_status_change: now,
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
          `Attempted to update case-role status for non-existent member: Server ${serverId}, User ${userId}`
        );
        return null;
      }
      this.handleError(error, 'updateCaseRoleStatus');
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
      case_role_active: false,
      reputation_score: 0, // Default neutral score (matches schema default)
      verification_status: VerificationStatus.PENDING, // Use enum member
      discord_member_pending: false,
    });
    // Errors from findByServerAndUser or upsertMember are already handled internally
  }

  async updateDiscordMemberPendingState(
    serverId: string,
    userId: string,
    pending: boolean,
    observedAt: Date = new Date()
  ): Promise<DiscordMemberPendingStateUpdate | null> {
    try {
      const existing = await this.findByServerAndUser(serverId, userId);
      if (!existing) {
        return null;
      }

      const wasPending = existing.discord_member_pending === true;
      const updatedMember = await this.prisma.server_members.update({
        where: {
          server_id_user_id: {
            server_id: serverId,
            user_id: userId,
          },
        },
        data: {
          discord_member_pending: pending,
          discord_member_pending_since: pending
            ? (existing.discord_member_pending_since ?? observedAt)
            : null,
          discord_member_pending_cleared_at:
            !pending && wasPending ? observedAt : existing.discord_member_pending_cleared_at,
          discord_member_pending_last_checked_at: observedAt,
          discord_member_pending_digest_sent_at:
            pending && !wasPending ? null : existing.discord_member_pending_digest_sent_at,
        },
      });

      return {
        member: updatedMember as ServerMember,
        wasPending,
        isPending: pending,
        pendingChanged: wasPending !== pending,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(
          `Attempted to update Discord pending state for non-existent member: Server ${serverId}, User ${userId}`
        );
        return null;
      }
      this.handleError(error, 'updateDiscordMemberPendingState');
    }
  }
}
