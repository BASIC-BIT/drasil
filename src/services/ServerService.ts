import { Server, ServerSettings } from '../repositories/types';
import { IServerRepository } from '../repositories/ServerRepository';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/symbols';

/**
 * Interface for the ServerService
 */
export interface IServerService {
  /**
   * Get an existing server by Discord guild ID or create a new one
   * @param guildId The Discord guild ID
   * @returns The server data
   */
  getOrCreateServer(guildId: string): Promise<Server>;

  /**
   * Update server settings
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server
   */
  updateServerSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null>;

  /**
   * Mark a server as active or inactive
   * @param guildId The Discord guild ID
   * @param isActive Whether the bot is active in this server
   * @returns The updated server
   */
  setServerActive(guildId: string, isActive: boolean): Promise<Server | null>;
}

/**
 * Service for managing Discord servers
 */
@injectable()
export class ServerService implements IServerService {
  constructor(@inject(TYPES.ServerRepository) private serverRepository: IServerRepository) {}

  /**
   * Get an existing server by Discord guild ID or create a new one
   * @param guildId The Discord guild ID
   * @returns The server data
   */
  async getOrCreateServer(guildId: string): Promise<Server> {
    const server = await this.serverRepository.findByGuildId(guildId);

    if (server) {
      return server;
    }

    // Create new server with default settings
    return await this.serverRepository.upsertByGuildId(guildId, {
      guild_id: guildId,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  /**
   * Update server settings
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server
   */
  async updateServerSettings(
    guildId: string,
    settings: Partial<ServerSettings>
  ): Promise<Server | null> {
    return await this.serverRepository.updateSettings(guildId, settings);
  }

  /**
   * Mark a server as active or inactive
   * @param guildId The Discord guild ID
   * @param isActive Whether the bot is active in this server
   * @returns The updated server
   */
  async setServerActive(guildId: string, isActive: boolean): Promise<Server | null> {
    return await this.serverRepository.setActive(guildId, isActive);
  }
}
