import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';
import { User } from './types';
import { TYPES } from '../di/symbols';

/**
 * Interface for UserRepository
 */
export interface IUserRepository {
  /**
   * Find a user by Discord ID
   * @param discordId The Discord user ID
   * @returns The user data or null if not found
   */
  findByDiscordId(discordId: string): Promise<User | null>;

  /**
   * Create or update a user
   * @param discordId The Discord user ID
   * @param data The user data to upsert
   * @returns The created or updated user
   */
  upsertByDiscordId(discordId: string, data: Partial<User>): Promise<User>;

  /**
   * Update a user's global reputation score
   * @param discordId The Discord user ID
   * @param score The new reputation score
   * @returns The updated user
   */
  updateReputationScore(discordId: string, score: number): Promise<User | null>;

  /**
   * Get all users with reputation scores below a threshold
   * @param threshold The reputation score threshold
   * @returns Array of users below the threshold
   */
  findByReputationBelow(threshold: number): Promise<User[]>;
}

/**
 * Repository for managing user data
 */
@injectable()
export class UserRepository extends SupabaseRepository<User> implements IUserRepository {
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('users', supabaseClient);
  }

  /**
   * Find a user by Discord ID
   * @param discordId The Discord user ID
   * @returns The user data or null if not found
   */
  async findByDiscordId(discordId: string): Promise<User | null> {
    try {
      const { data, error } = await this.supabaseClient
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
   * Create or update a user
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

      const { data: upserted, error } = await this.supabaseClient
        .from(this.tableName)
        .upsert(userData, { onConflict: 'discord_id' })
        .select()
        .single();

      if (error) throw error;
      if (!upserted) throw new Error('Failed to upsert user: No data returned');

      return upserted as User;
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
  async updateReputationScore(discordId: string, score: number): Promise<User | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          global_reputation_score: score,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return data as User;
    } catch (error) {
      this.handleError(error as Error, 'updateReputationScore');
    }
  }

  /**
   * Get all users with reputation scores below a threshold
   * @param threshold The reputation score threshold
   * @returns Array of users below the threshold
   */
  async findByReputationBelow(threshold: number): Promise<User[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .lt('global_reputation_score', threshold);

      if (error) throw error;
      return (data as User[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findByReputationBelow');
    }
  }
}
