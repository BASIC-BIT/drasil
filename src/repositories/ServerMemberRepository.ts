import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';
import { ServerMember } from './types';
import { TYPES } from '../di/symbols';

/**
 * Interface for the ServerMemberRepository
 */
export interface IServerMemberRepository {
  /**
   * Find a server member by server ID and user ID
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The server member or null if not found
   */
  findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null>;

  /**
   * Create or update a server member
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param data The server member data to upsert
   * @returns The created or updated server member
   */
  upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember>;

  /**
   * Find all members in a server
   * @param serverId The Discord server ID
   * @returns Array of server members
   */
  findByServer(serverId: string): Promise<ServerMember[]>;

  /**
   * Find all memberships for a specific user across all servers
   * @param userId The Discord user ID
   * @returns Array of server members
   */
  findByUser(userId: string): Promise<ServerMember[]>;

  /**
   * Find all restricted members in a server
   * @param serverId The Discord server ID
   * @returns Array of restricted server members
   */
  findRestrictedMembers(serverId: string): Promise<ServerMember[]>;

  /**
   * Update a member's reputation score
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param score The new reputation score
   * @returns The updated server member
   */
  updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null>;

  /**
   * Update member's restriction status
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param isRestricted Whether the user is restricted
   * @param reason Optional reason for restriction
   * @param moderatorId Optional Discord ID of the moderator
   * @returns The updated server member
   */
  updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean,
    reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null>;

  /**
   * Increment a member's message count and update last_message_at timestamp
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The updated server member
   */
  incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null>;
}

/**
 * Repository for managing server members (users in specific servers)
 */
@injectable()
export class ServerMemberRepository
  extends SupabaseRepository<ServerMember>
  implements IServerMemberRepository
{
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('server_members', supabaseClient);
  }

  /**
   * Find a server member by server ID and user ID
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The server member or null if not found
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as ServerMember) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByServerAndUser');
    }
  }

  /**
   * Create or update a server member
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param data The server member data to upsert
   * @returns The created or updated server member
   */
  async upsertMember(
    serverId: string,
    userId: string,
    data: Partial<ServerMember>
  ): Promise<ServerMember> {
    try {
      // Include the server_id and user_id in the data
      const memberData = {
        server_id: serverId,
        user_id: userId,
        ...data,
      };

      // Use upsert operation with server_id and user_id as the composite primary key
      const { data: upserted, error } = await this.supabaseClient
        .from(this.tableName)
        .upsert(memberData, { onConflict: 'server_id,user_id' })
        .select()
        .single<ServerMember>();

      if (error) throw error;
      if (!upserted) throw new Error('Failed to upsert server member: No data returned');

      return upserted;
    } catch (error) {
      this.handleError(error as Error, 'upsertMember');
    }
  }

  /**
   * Find all members in a server
   * @param serverId The Discord server ID
   * @returns Array of server members
   */
  async findByServer(serverId: string): Promise<ServerMember[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId);

      if (error) throw error;
      return (data as ServerMember[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByServer');
    }
  }

  /**
   * Find all memberships for a specific user across all servers
   * @param userId The Discord user ID
   * @returns Array of server members
   */
  async findByUser(userId: string): Promise<ServerMember[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('user_id', userId);

      if (error) throw error;
      return (data as ServerMember[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByUser');
    }
  }

  /**
   * Find all restricted members in a server
   * @param serverId The Discord server ID
   * @returns Array of restricted server members
   */
  async findRestrictedMembers(serverId: string): Promise<ServerMember[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('server_id', serverId)
        .eq('is_restricted', true);

      if (error) throw error;
      return (data as ServerMember[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findRestrictedMembers');
    }
  }

  /**
   * Update a member's reputation score
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param score The new reputation score
   * @returns The updated server member
   */
  async updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({ reputation_score: score })
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .select()
        .single();

      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as ServerMember) || null;
    } catch (error) {
      this.handleError(error as Error, 'updateReputationScore');
    }
  }

  /**
   * Update member's restriction status
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @param isRestricted Whether the user is restricted
   * @param reason Optional reason for restriction
   * @param moderatorId Optional Discord ID of the moderator
   * @returns The updated server member
   */
  async updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean,
    reason?: string,
    moderatorId?: string
  ): Promise<ServerMember | null> {
    try {
      const now = new Date().toISOString();
      const updateData: Partial<ServerMember> & { last_status_change: string } = {
        is_restricted: isRestricted,
        last_status_change: now,
        restriction_reason: reason || undefined,
        moderator_id: moderatorId || undefined,
        updated_by: moderatorId || undefined,
      };

      const { data: updated, error } = await this.supabaseClient
        .from(this.tableName)
        .update(updateData)
        .eq('server_id', serverId)
        .eq('user_id', userId)
        .select()
        .single<ServerMember>();

      if (error) throw error;
      return updated || null;
    } catch (error) {
      this.handleError(error as Error, 'updateRestrictionStatus');
    }
  }

  /**
   * Increment a member's message count and update last_message_at timestamp
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
   * @returns The updated server member
   */
  async incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const timestamp = new Date().toISOString();
      const { data, error } = await this.supabaseClient.rpc('increment_member_message_count', {
        p_server_id: serverId,
        p_user_id: userId,
        p_timestamp: timestamp,
      });

      if (error) throw error;
      return (data as ServerMember) || null;
    } catch (error) {
      this.handleError(error as Error, 'incrementMessageCount');
    }
  }
}
