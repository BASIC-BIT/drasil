import { injectable, inject } from 'inversify';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';
import { Server, ServerSettings } from './types';
import { TYPES } from '../di/symbols';

/**
 * Interface for the ServerRepository
 */
export interface IServerRepository {
  /**
   * Find a server by Discord guild ID
   * @param guildId The Discord guild ID
   * @returns The server configuration or null if not found
   */
  findByGuildId(guildId: string): Promise<Server | null>;

  /**
   * Create or update a server configuration
   * @param guildId The Discord guild ID
   * @param data The server data to upsert
   * @returns The created or updated server
   */
  upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server>;

  /**
   * Update specific settings for a server
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server
   */
  updateSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null>;

  /**
   * Mark a server as active or inactive
   * @param guildId The Discord guild ID
   * @param isActive Whether the bot is active in this server
   * @returns The updated server
   */
  setActive(guildId: string, isActive: boolean): Promise<Server | null>;

  /**
   * Get all active server configurations
   * @returns Array of active servers
   */
  findAllActive(): Promise<Server[]>;
}

/**
 * Repository for managing server/guild configurations
 */
@injectable()
export class ServerRepository extends SupabaseRepository<Server> implements IServerRepository {
  constructor(@inject(TYPES.SupabaseClient) supabaseClient: SupabaseClient) {
    super('servers', supabaseClient);
  }

  /**
   * Find a server by Discord guild ID
   * @param guildId The Discord guild ID
   * @returns The server configuration or null if not found
   */
  async findByGuildId(guildId: string): Promise<Server | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('guild_id', guildId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return (data as Server) || null;
    } catch (error) {
      this.handleError(error as Error, 'findByGuildId');
    }
  }

  /**
   * Create or update a server configuration
   * @param guildId The Discord guild ID
   * @param data The server data to upsert
   * @returns The created or updated server
   */
  async upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server> {
    try {
      // Include the guild_id in the data
      const serverData = {
        guild_id: guildId,
        ...data,
        updated_at: new Date().toISOString(),
      };

      // Use upsert operation with guild_id as the primary key
      const { data: upserted, error } = await this.supabaseClient
        .from(this.tableName)
        .upsert(serverData, { onConflict: 'guild_id' })
        .select()
        .single();

      if (error) throw error;
      if (!upserted) throw new Error('Failed to upsert server: No data returned');

      return upserted as Server;
    } catch (error) {
      this.handleError(error as Error, 'upsertByGuildId');
    }
  }

  /**
   * Update specific settings for a server
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server
   */
  async updateSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null> {
    try {
      const server = await this.findByGuildId(guildId);
      if (!server) return null;

      // Merge existing settings with new ones
      const updatedSettings = {
        ...(server.settings || {}),
        ...settings,
      };

      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          settings: updatedSettings,
          updated_at: new Date().toISOString(),
        })
        .eq('guild_id', guildId)
        .select()
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return data as Server;
    } catch (error) {
      this.handleError(error as Error, 'updateSettings');
    }
  }

  /**
   * Mark a server as active or inactive
   * @param guildId The Discord guild ID
   * @param isActive Whether the bot is active in this server
   * @returns The updated server
   */
  async setActive(guildId: string, isActive: boolean): Promise<Server | null> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('guild_id', guildId)
        .select()
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (error && error.code === 'PGRST116') {
        return null;
      } else if (error) {
        throw error;
      }
      return data as Server;
    } catch (error) {
      this.handleError(error as Error, 'setActive');
    }
  }

  /**
   * Get all active server configurations
   * @returns Array of active servers
   */
  async findAllActive(): Promise<Server[]> {
    try {
      const { data, error } = await this.supabaseClient
        .from(this.tableName)
        .select('*')
        .eq('is_active', true);

      if (error) throw error;
      return (data as Server[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findAllActive');
    }
  }
}
