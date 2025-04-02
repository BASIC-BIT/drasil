import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './BaseRepository';
import { User } from './types';
import { TYPES } from '../di/symbols';

/**
 * Interface for UserRepository
 */
export interface IUserRepository {
  /**
   * Find a user by ID
   * @param id The user ID
   * @returns The user data or null if not found
   */
  findById(id: string): Promise<User | null>;

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

  /**
   * Increment the number of servers where a user is flagged as suspicious
   * @param discordId The Discord user ID
   * @returns The updated user
   */
  incrementSuspiciousServerCount(discordId: string): Promise<User | null>;

  /**
   * Decrement the number of servers where a user is flagged as suspicious
   * @param discordId The Discord user ID
   * @returns The updated user
   */
  decrementSuspiciousServerCount(discordId: string): Promise<User | null>;

  /**
   * Mark a user as first flagged
   * @param discordId The Discord user ID
   * @param timestamp Optional timestamp of first flag (defaults to now)
   * @returns The updated user
   */
  setFirstFlagged(discordId: string, timestamp?: string): Promise<User | null>;

  /**
   * Find users with suspicious activity in multiple servers
   * @param threshold Minimum number of suspicious servers (default: 2)
   * @returns Array of users flagged in multiple servers
   */
  findUsersFlaggedInMultipleServers(threshold?: number): Promise<User[]>;

  /**
   * Get an existing user by Discord ID or create a new one
   * @param discordId The Discord user ID
   * @param username The Discord username (optional)
   * @returns The user data
   */
  getOrCreateUser(discordId: string, username?: string): Promise<User>;
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
   * Find a user by ID
   * @param id The user ID
   * @returns The user data or null if not found
   */
  async findById(id: string): Promise<User | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('id', id)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as User) || null;
    } catch (error) {
      this.handleError(error as Error, 'findById');
    }
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

  /**
   * Increment the number of servers where a user is flagged as suspicious
   * @param discordId The Discord user ID
   * @returns The updated user
   */
  async incrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    try {
      // First, check if the user exists and get their current count
      const user = await this.findByDiscordId(discordId);
      if (!user) return null;

      // Calculate the new count
      const currentCount = user.suspicious_server_count || 0;
      const newCount = currentCount + 1;

      // Update with the new count
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          suspicious_server_count: newCount,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      if (error) throw error;
      return data as User;
    } catch (error) {
      this.handleError(error as Error, 'incrementSuspiciousServerCount');
    }
  }

  /**
   * Decrement the number of servers where a user is flagged as suspicious
   * @param discordId The Discord user ID
   * @returns The updated user
   */
  async decrementSuspiciousServerCount(discordId: string): Promise<User | null> {
    try {
      // First, check if the user exists and get their current count
      const user = await this.findByDiscordId(discordId);
      if (!user) return null;

      // Calculate the new count (never go below 0)
      const currentCount = user.suspicious_server_count || 0;
      const newCount = Math.max(0, currentCount - 1);

      // Update with the new count
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          suspicious_server_count: newCount,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      if (error) throw error;
      return data as User;
    } catch (error) {
      this.handleError(error as Error, 'decrementSuspiciousServerCount');
    }
  }

  /**
   * Mark a user as first flagged
   * @param discordId The Discord user ID
   * @param timestamp Optional timestamp of first flag (defaults to now)
   * @returns The updated user
   */
  async setFirstFlagged(discordId: string, timestamp?: string): Promise<User | null> {
    try {
      // First, check if the user exists
      const user = await this.findByDiscordId(discordId);
      if (!user) return null;

      // Only set first_flagged_at if it's not already set
      if (user.first_flagged_at) {
        return user;
      }

      // Set the first_flagged_at timestamp
      const flaggedTime = timestamp || new Date().toISOString();
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          first_flagged_at: flaggedTime,
          updated_at: new Date().toISOString(),
        })
        .eq('discord_id', discordId)
        .select()
        .single();

      if (error) throw error;
      return data as User;
    } catch (error) {
      this.handleError(error as Error, 'setFirstFlagged');
    }
  }

  /**
   * Find users with suspicious activity in multiple servers
   * @param threshold Minimum number of suspicious servers (default: 2)
   * @returns Array of users flagged in multiple servers
   */
  async findUsersFlaggedInMultipleServers(threshold: number = 2): Promise<User[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .gte('suspicious_server_count', threshold);

      if (error) throw error;
      return (data as User[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findUsersFlaggedInMultipleServers');
    }
  }

  /**
   * Get an existing user by Discord ID or create a new one
   * @param discordId The Discord user ID
   * @param username The Discord username (optional)
   * @returns The user data
   */
  async getOrCreateUser(discordId: string, username?: string): Promise<User> {
    const user = await this.findByDiscordId(discordId);

    if (user) {
      // Update username if it changed
      if (username && user.username !== username) {
        return await this.upsertByDiscordId(discordId, {
          ...user,
          username,
        });
      }
      return user;
    }

    // Create new user
    return await this.upsertByDiscordId(discordId, {
      discord_id: discordId,
      username: username || 'Unknown User',
      global_reputation_score: 100, // Default reputation score
      // Use actual timestamp for new users
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }
}
