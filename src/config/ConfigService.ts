import { injectable, inject } from 'inversify';
import { IServerRepository } from '../repositories/ServerRepository';
import { Server, ServerSettings } from '../repositories/types';
import { isSupabaseConfigured } from './supabase';
import { globalConfig } from './GlobalConfig';
import { TYPES } from '../di/symbols';
import { Client, Role, TextChannel } from 'discord.js';
/**
 * Interface for the ConfigService
 */
export interface IConfigService {
  /**
   * Initialize the configuration service
   * Loads all active servers into cache
   */
  initialize(): Promise<void>;

  /**
   * Get a server configuration, first from cache, then from database
   * Falls back to environment variables if needed
   * @param guildId The Discord guild ID
   * @returns The server configuration
   */
  getServerConfig(guildId: string): Promise<Server>;

  /**
   * Update a server configuration
   * @param guildId The Discord guild ID
   * @param data The data to update
   * @returns The updated server configuration
   */
  updateServerConfig(guildId: string, data: Partial<Server>): Promise<Server>;

  /**
   * Update specific settings for a server
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server configuration
   */
  updateServerSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server>;

  /**
   * Clear the server cache
   */
  clearCache(): void;

  /**
   * Get the admin channel for a server
   * @param guildId The Discord guild ID
   * @returns The admin channel
   */
  getAdminChannel(guildId: string): Promise<TextChannel | undefined>;

  /**
   * Get the verification channel for a server
   * @param guildId The Discord guild ID
   * @returns The verification channel
   */
  getVerificationChannel(guildId: string): Promise<TextChannel | undefined>;

  /**
   * Get the restricted role for a server
   * @param guildId The Discord guild ID
   * @returns The restricted role
   */
  getRestrictedRole(guildId: string): Promise<Role | null>;
}

/**
 * Service for managing configuration and providing a bridge
 * between environment variables and database configuration
 */
@injectable()
export class ConfigService implements IConfigService {
  private serverRepository: IServerRepository;
  private serverCache: Map<string, Server> = new Map();
  private discordClient: Client;

  constructor(
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.DiscordClient) discordClient: Client
  ) {
    this.serverRepository = serverRepository;
    this.discordClient = discordClient;
  }

  /**
   * Initialize the configuration service
   * Loads all active servers into cache
   */
  async initialize(): Promise<void> {
    // Only attempt to load from database if Supabase is configured
    if (isSupabaseConfigured()) {
      try {
        const servers = await this.serverRepository.findAllActive();

        // Cache all active servers
        servers.forEach((server) => {
          this.serverCache.set(server.guild_id, server);
        });

        console.log(`Loaded ${servers.length} server configurations from database`);
      } catch (error) {
        console.error('Failed to load server configurations from database:', error);
      }
    } else {
      console.warn('Supabase is not configured. Using environment variables for configuration.');
    }
  }

  /**
   * Get the admin channel for a server
   * @param guildId The Discord guild ID
   * @returns The admin channel
   */
  async getAdminChannel(guildId: string): Promise<TextChannel | undefined> {
    const server = await this.getServerConfig(guildId);
    if (!server.admin_channel_id) {
      return undefined;
    }
    const channel = await this.discordClient.channels.fetch(server.admin_channel_id);
    if (!channel) {
      return undefined;
    }
    return channel as TextChannel;
  }

  /**
   * Get the verification channel for a server
   * @param guildId The Discord guild ID
   * @returns The verification channel
   */
  async getVerificationChannel(guildId: string): Promise<TextChannel | undefined> {
    const server = await this.getServerConfig(guildId);
    if (!server.verification_channel_id) {
      return undefined;
    }
    const channel = await this.discordClient.channels.fetch(server.verification_channel_id);
    return channel as TextChannel;
  }

  public async getRestrictedRole(guildId: string): Promise<Role | null> {
    const server = await this.getServerConfig(guildId);
    if (!server.restricted_role_id) {
      return null;
    }
    const guild = await this.discordClient.guilds.fetch(guildId);
    const role = await guild.roles.fetch(server.restricted_role_id);
    return role;
  }

  /**
   * Get a server configuration, first from cache, then from database
   * Falls back to environment variables if needed
   * @param guildId The Discord guild ID
   * @returns The server configuration
   */
  async getServerConfig(guildId: string): Promise<Server> {
    // Check cache first
    const cachedServer = this.serverCache.get(guildId);
    if (cachedServer) {
      return cachedServer;
    }

    // Try to get from database if Supabase is configured
    if (isSupabaseConfigured()) {
      try {
        const server = await this.serverRepository.findByGuildId(guildId);
        if (server) {
          // Update cache
          this.serverCache.set(guildId, server);
          return server;
        }

        // If no server found, create a default one and save it
        const defaultConfig = this.createDefaultConfig(guildId);
        // Create a copy of defaultConfig without the 'id' field to avoid UUID validation errors
        // Extract only the fields we want to send to the database
        const configForDb = {
          guild_id: defaultConfig.guild_id,
          restricted_role_id: defaultConfig.restricted_role_id,
          admin_channel_id: defaultConfig.admin_channel_id,
          verification_channel_id: defaultConfig.verification_channel_id,
          admin_notification_role_id: defaultConfig.admin_notification_role_id,
          is_active: defaultConfig.is_active,
          settings: defaultConfig.settings,
        };
        await this.serverRepository.upsertByGuildId(guildId, configForDb);

        // Retrieve the saved server to ensure we have the complete object
        const savedServer = await this.serverRepository.findByGuildId(guildId);
        if (savedServer) {
          this.serverCache.set(guildId, savedServer);
          return savedServer;
        }

        // Fallback to the default config if we couldn't retrieve the saved server
        this.serverCache.set(guildId, defaultConfig);
        return defaultConfig;
      } catch (error) {
        console.error(`Failed to get server configuration for guild ${guildId}:`, error);
      }
    }

    // If no configuration exists yet or database failed, create a default one
    const defaultConfig = this.createDefaultConfig(guildId);
    this.serverCache.set(guildId, defaultConfig);
    return defaultConfig;
  }

  /**
   * Create a default server configuration using environment variables
   * @param guildId The Discord guild ID
   * @returns The default server configuration
   */
  private createDefaultConfig(guildId: string): Server {
    const globalSettings = globalConfig.getSettings();
    const defaultSettings = {
      message_threshold: globalSettings.defaultServerSettings.messageThreshold,
      message_timeframe: globalSettings.defaultServerSettings.messageTimeframe,
      suspicious_keywords: globalSettings.defaultSuspiciousKeywords,
      min_confidence_threshold: globalSettings.defaultServerSettings.minConfidenceThreshold,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: 3,
      message_retention_days: globalSettings.defaultServerSettings.messageRetentionDays,
      detection_retention_days: globalSettings.defaultServerSettings.detectionRetentionDays,
    };

    // Create an in-memory server object
    return {
      guild_id: guildId,
      restricted_role_id: undefined,
      admin_channel_id: undefined,
      verification_channel_id: undefined,
      admin_notification_role_id: undefined,
      is_active: true,
      settings: defaultSettings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Create or get a server configuration, preserving existing settings if found
   * @param guildId The Discord guild ID
   * @returns The server configuration
   */
  private async createDefaultServerConfig(guildId: string): Promise<Server> {
    // Try to get existing server first
    let existingServer: Server | null = null;
    if (isSupabaseConfigured()) {
      try {
        existingServer = await this.serverRepository.findByGuildId(guildId);
      } catch (error) {
        console.error(`Failed to fetch existing server config for guild ${guildId}:`, error);
      }
    }

    // If we have an existing server, return it as is without modifying its settings
    if (existingServer) {
      // This is the important part - we're preserving the existing server settings
      return existingServer;
    }

    // Otherwise, create a new default configuration
    return this.createDefaultConfig(guildId);
  }

  /**
   * Update a server configuration
   * @param guildId The Discord guild ID
   * @param data The data to update
   * @returns The updated server configuration
   */
  async updateServerConfig(guildId: string, data: Partial<Server>): Promise<Server> {
    if (isSupabaseConfigured()) {
      try {
        const server = await this.serverRepository.upsertByGuildId(guildId, data);
        // Update cache
        this.serverCache.set(guildId, server);
        return server;
      } catch (error) {
        console.error(`Failed to update server configuration for guild ${guildId}:`, error);
      }
    }

    // If we couldn't save to database, update the cached version or create a new one
    const currentConfig =
      this.serverCache.get(guildId) || (await this.createDefaultServerConfig(guildId));
    const updatedServer: Server = {
      ...currentConfig,
      ...data,
      updated_at: new Date().toISOString(),
    };

    // Update cache
    this.serverCache.set(guildId, updatedServer);
    return updatedServer;
  }

  /**
   * Update specific settings for a server
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server configuration
   */
  async updateServerSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server> {
    // Get current server config
    const currentConfig = await this.getServerConfig(guildId);

    // Merge existing settings with new ones
    const updatedSettings = {
      ...(currentConfig.settings || {}),
      ...settings,
    };

    // Update the server configuration with new settings
    return this.updateServerConfig(guildId, { settings: updatedSettings });
  }

  /**
   * Clear the server cache
   */
  clearCache(): void {
    this.serverCache.clear();
  }
}
