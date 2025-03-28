import { SupabaseRepository } from './SupabaseRepository';
import { ServerMember } from './types';
import { supabase } from '../config/supabase';

/**
 * Repository for managing server members (users in specific servers)
 */
export class ServerMemberRepository extends SupabaseRepository<ServerMember> {
  constructor() {
    super('server_members');
  }

  /**
   * Find a server member by server ID and user ID
   * @param serverId The server UUID
   * @param userId The user UUID
   * @returns The server member or null if not found
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const { data, error } = await supabase
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
   * @param serverId The server UUID
   * @param userId The user UUID
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

      const existing = await this.findByServerAndUser(serverId, userId);

      if (existing) {
        // Update existing member
        const { data: updated, error } = await supabase
          .from(this.tableName)
          .update(memberData)
          .eq('server_id', serverId)
          .eq('user_id', userId)
          .select()
          .single();

        if (error) throw error;
        return updated as ServerMember;
      } else {
        // Create new member
        const { data: created, error } = await supabase
          .from(this.tableName)
          .insert(memberData)
          .select()
          .single();

        if (error) throw error;
        if (!created) throw new Error('Failed to create server member: No data returned');

        return created as ServerMember;
      }
    } catch (error) {
      this.handleError(error as Error, 'upsertMember');
    }
  }

  /**
   * Find all members in a server
   * @param serverId The server UUID
   * @returns Array of server members
   */
  async findByServer(serverId: string): Promise<ServerMember[]> {
    try {
      const { data, error } = await supabase
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
   * Find all restricted members in a server
   * @param serverId The server UUID
   * @returns Array of restricted server members
   */
  async findRestrictedMembers(serverId: string): Promise<ServerMember[]> {
    try {
      const { data, error } = await supabase
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
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param score The new reputation score
   * @returns The updated server member
   */
  async updateReputationScore(
    serverId: string,
    userId: string,
    score: number
  ): Promise<ServerMember | null> {
    try {
      const { data, error } = await supabase
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
   * Update member's message count and last message timestamp
   * @param serverId The server UUID
   * @param userId The user UUID
   * @returns The updated server member
   */
  async incrementMessageCount(serverId: string, userId: string): Promise<ServerMember | null> {
    try {
      const { data, error } = await supabase.rpc('increment_member_message_count', {
        p_server_id: serverId,
        p_user_id: userId,
        p_timestamp: new Date().toISOString(),
      });

      if (error) throw error;
      return (data as ServerMember) || null;
    } catch (error) {
      this.handleError(error as Error, 'incrementMessageCount');
    }
  }

  /**
   * Update member's verification status
   * @param serverId The server UUID
   * @param userId The user UUID
   * @param isRestricted Whether the user is restricted
   * @returns The updated server member
   */
  async updateRestrictionStatus(
    serverId: string,
    userId: string,
    isRestricted: boolean
  ): Promise<ServerMember | null> {
    try {
      const updateData: Partial<ServerMember> = {
        is_restricted: isRestricted,
      };

      // If the user is being unrestricted, update the verification timestamp
      if (!isRestricted) {
        updateData.last_verified_at = new Date().toISOString();
      }

      const { data, error } = await supabase
        .from(this.tableName)
        .update(updateData)
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
      this.handleError(error as Error, 'updateRestrictionStatus');
    }
  }
}
