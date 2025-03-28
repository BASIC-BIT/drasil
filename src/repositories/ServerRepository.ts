import { SupabaseRepository } from './SupabaseRepository';
import { Server, ServerSettings } from './types';
import { supabase } from '../config/supabase';

/**
 * Repository for managing server/guild configurations
 */
export class ServerRepository extends SupabaseRepository<Server> {
  constructor() {
    super('servers');
  }

  /**
   * Find a server by Discord guild ID
   * @param guildId The Discord guild ID
   * @returns The server configuration or null if not found
   */
  async findByGuildId(guildId: string): Promise<Server | null> {
    try {
      const { data, error } = await supabase
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

      const { data: existing, error: findError } = await supabase
        .from(this.tableName)
        .select('id')
        .eq('guild_id', guildId)
        .single();

      // Handle the specific "no rows" error as a valid "not found" case
      if (findError && findError.code !== 'PGRST116') {
        throw findError;
      }

      if (existing) {
        // Update existing server
        const { data: updated, error } = await supabase
          .from(this.tableName)
          .update(serverData)
          .eq('guild_id', guildId)
          .select()
          .single();

        if (error) throw error;
        return updated as Server;
      } else {
        // Create new server
        const { data: created, error } = await supabase
          .from(this.tableName)
          .insert({ ...serverData, created_at: new Date().toISOString() })
          .select()
          .single();

        if (error) throw error;
        if (!created) throw new Error('Failed to create server: No data returned');

        return created as Server;
      }
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

      const { data, error } = await supabase
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
      const { data, error } = await supabase
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
      const { data, error } = await supabase.from(this.tableName).select('*').eq('is_active', true);

      if (error) throw error;
      return (data as Server[]) || [];
    } catch (error) {
      this.handleError(error as Error, 'findAllActive');
    }
  }
}
