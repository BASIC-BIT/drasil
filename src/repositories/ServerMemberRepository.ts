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
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
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
      const { data: upserted, error } = await supabase
        .from(this.tableName)
        .upsert(memberData, { onConflict: 'server_id,user_id' })
        .select()
        .single();

      if (error) throw error;
      if (!upserted) throw new Error('Failed to upsert server member: No data returned');

      return upserted as ServerMember;
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
   * @param serverId The Discord server ID
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
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
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
   * @param serverId The Discord server ID
   * @param userId The Discord user ID
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
