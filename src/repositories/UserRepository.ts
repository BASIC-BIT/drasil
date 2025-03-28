import { SupabaseRepository } from './SupabaseRepository';
import { User } from './types';
import { supabase } from '../config/supabase';

/**
 * Repository for managing Discord users across servers
 */
export class UserRepository extends SupabaseRepository<User> {
  constructor() {
    super('users');
  }

  /**
   * Find a user by Discord ID
   * @param discordId The Discord user ID
   * @returns The user or null if not found
   */
  async findByDiscordId(discordId: string): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .eq('discord_id', discordId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as User) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByDiscordId');
    }
  }

  /**
   * Create or update a user by Discord ID
   * @param discordId The Discord user ID
   * @param data The user data to upsert
   * @returns The created or updated user
   */
  async upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User> {
    try {
      // Include the discord_id in the data
      const userData = {
        discord_id: discordId,
        ...data,
        updated_at: new Date().toISOString(),
      };

      const { data: existing, error: findError } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('discord_id', discordId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (findError && findError.code !== 'PGRST116') {
        throw findError;
      }

      if (existing) {
        // Update existing user
        const { data: updated, error } = await supabase
          .from(this.tableName)
          .update(userData)
          .eq('discord_id', discordId)
          .select()
          .single();

        if (error) throw error;
        return updated as User;
      } else {
        // Create new user
        const { data: created, error } = await supabase
          .from(this.tableName)
          .insert({ ...userData, created_at: new Date().toISOString() })
          .select()
          .single();

        if (error) throw error;
        if (!created) throw new Error('Failed to create user: No data returned');

        return created as User;
      }
    } catch (error) {
      this.handleError(error as Error, 'upsertByDiscordId');
    }
  }

  /**
   * Update a user's global reputation score
   * @param discordId The Discord user ID
   * @param score The new reputation score
   * @returns The updated user
   */
  async updateGlobalReputationScore(discordId: string, score: number): Promise<User | null> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .update({
          global_reputation_score: score,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as User) || null;
    } catch (error) {
      this.handleError(error as Error, 'updateGlobalReputationScore');
    }
  }

  /**
   * Find users with reputation scores below a threshold
   * @param threshold The reputation score threshold
   * @returns Array of users below the threshold
   */
  async findUsersWithLowReputation(threshold: number): Promise<User[]> {
    try {
      const { data, error } = await supabase
        .from(this.tableName)
        .select('*')
        .lt('global_reputation_score', threshold);

      if (error) throw error;
      return (data as User[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findUsersWithLowReputation');
    }
  }

  /**
   * Update user metadata
   * @param discordId The Discord user ID
   * @param metadata The metadata to update/merge
   * @returns The updated user
   */
  async updateMetadata(discordId: string, metadata: Record<string, unknown>): Promise<User | null> {
    try {
      // First get the current metadata
      const current = await this.findByDiscordId(discordId);
      if (!current) return null;

      // Merge the new metadata with existing
      const updatedMetadata = {
        ...(current.metadata || {}),
        ...metadata,
      };

      const { data, error } = await supabase
        .from(this.tableName)
        .update({
          metadata: updatedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      if (error) throw error;
      return (data as User) || null;
    } catch (error) {
      this.handleError(error as Error, 'updateMetadata');
    }
  }
}
