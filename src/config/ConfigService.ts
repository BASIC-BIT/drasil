import { injectable, inject } from 'inversify';
import { Client, Role, TextChannel } from 'discord.js';
import { z } from 'zod';
import { IServerRepository } from '../repositories/ServerRepository';
import { Server, ServerSettings } from '../repositories/types';
import { globalConfig } from './GlobalConfig';
import { TYPES } from '../di/symbols';

const MAX_HEURISTIC_MESSAGE_THRESHOLD = 100;
const MAX_HEURISTIC_TIMEFRAME_SECONDS = 600;
const MAX_HEURISTIC_KEYWORDS = 200;

export interface HeuristicSettings {
  readonly messageThreshold: number;
  readonly timeWindowMs: number;
  readonly suspiciousKeywords: readonly string[];
}

export interface HeuristicSettingsUpdate {
  messageThreshold?: number;
  timeframeSeconds?: number;
  suspiciousKeywords?: string[];
}

const CachedServerHeuristicSettingsSchema = z.object({
  heuristic_message_threshold: z.number().int().min(1).max(MAX_HEURISTIC_MESSAGE_THRESHOLD),
  heuristic_message_timeframe_seconds: z.number().int().min(1).max(MAX_HEURISTIC_TIMEFRAME_SECONDS),
  heuristic_suspicious_keywords: z
    .array(z.string().trim().min(1))
    .max(MAX_HEURISTIC_KEYWORDS)
    .default([]),
});

const HeuristicSettingsUpdateSchema = z
  .object({
    messageThreshold: z.number().int().min(1).max(MAX_HEURISTIC_MESSAGE_THRESHOLD).optional(),
    timeframeSeconds: z.number().int().min(1).max(MAX_HEURISTIC_TIMEFRAME_SECONDS).optional(),
    suspiciousKeywords: z.array(z.string().trim().min(1)).max(MAX_HEURISTIC_KEYWORDS).optional(),
  })
  .strict()
  .refine((value: HeuristicSettingsUpdate) => Object.keys(value).length > 0, {
    message: 'At least one heuristic setting must be provided.',
  });

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
   * Get a server configuration from in-memory cache only.
   * This must not hit the database and is safe to use on hot paths.
   */
  getCachedServerConfig(guildId: string): Server | undefined;

  /**
   * Get heuristic settings derived from the cached server config.
   * This must not hit the database and is safe to use on hot paths.
   */
  getCachedHeuristicSettings(guildId: string): HeuristicSettings;

  /**
   * Get heuristic settings, loading server config if needed.
   */
  getHeuristicSettings(guildId: string): Promise<HeuristicSettings>;

  /**
   * Update typed heuristic settings.
   */
  updateHeuristicSettings(
    guildId: string,
    updates: HeuristicSettingsUpdate
  ): Promise<HeuristicSettings>;

  /**
   * Reset typed heuristic settings to global defaults.
   */
  resetHeuristicSettings(guildId: string): Promise<HeuristicSettings>;

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
  private readonly serverRepository: IServerRepository;
  private readonly serverCache: Map<string, Server> = new Map();
  private readonly heuristicSettingsCache: Map<string, HeuristicSettings> = new Map();
  private readonly defaultHeuristicSettings: HeuristicSettings;
  private readonly discordClient: Client;

  constructor(
    @inject(TYPES.ServerRepository) serverRepository: IServerRepository,
    @inject(TYPES.DiscordClient) discordClient: Client
  ) {
    this.serverRepository = serverRepository;
    this.discordClient = discordClient;

    const globalSettings = globalConfig.getSettings();
    const defaultKeywords = this.normalizeKeywords(globalSettings.defaultSuspiciousKeywords);
    this.defaultHeuristicSettings = this.freezeHeuristicSettings({
      messageThreshold: globalSettings.defaultServerSettings.messageThreshold,
      timeWindowMs: globalSettings.defaultServerSettings.messageTimeframe * 1000,
      suspiciousKeywords: defaultKeywords,
    });
  }

  private normalizeKeywords(keywords: readonly string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];

    for (const rawKeyword of keywords) {
      const keyword = rawKeyword.trim().toLowerCase();
      if (!keyword || seen.has(keyword)) {
        continue;
      }

      seen.add(keyword);
      normalized.push(keyword);
    }

    return normalized;
  }

  private freezeHeuristicSettings(settings: {
    messageThreshold: number;
    timeWindowMs: number;
    suspiciousKeywords: readonly string[];
  }): HeuristicSettings {
    const frozenKeywords = Object.freeze([...settings.suspiciousKeywords]);
    return Object.freeze({
      messageThreshold: settings.messageThreshold,
      timeWindowMs: settings.timeWindowMs,
      suspiciousKeywords: frozenKeywords,
    });
  }

  private computeHeuristicSettings(server: Server): HeuristicSettings {
    const parsed = CachedServerHeuristicSettingsSchema.safeParse({
      heuristic_message_threshold: server.heuristic_message_threshold,
      heuristic_message_timeframe_seconds: server.heuristic_message_timeframe_seconds,
      heuristic_suspicious_keywords: server.heuristic_suspicious_keywords,
    });

    if (!parsed.success) {
      return this.defaultHeuristicSettings;
    }

    return this.freezeHeuristicSettings({
      messageThreshold: parsed.data.heuristic_message_threshold,
      timeWindowMs: parsed.data.heuristic_message_timeframe_seconds * 1000,
      suspiciousKeywords: this.normalizeKeywords(parsed.data.heuristic_suspicious_keywords),
    });
  }

  private cacheServerConfig(server: Server): void {
    this.serverCache.set(server.guild_id, server);
    this.heuristicSettingsCache.set(server.guild_id, this.computeHeuristicSettings(server));
  }

  private createDefaultConfig(guildId: string): Server {
    const globalSettings = globalConfig.getSettings();
    const defaultSettings: ServerSettings = {
      min_confidence_threshold: globalSettings.defaultServerSettings.minConfidenceThreshold,
      auto_restrict: true,
      use_gpt_on_join: true,
      gpt_message_check_count: 3,
      message_retention_days: globalSettings.defaultServerSettings.messageRetentionDays,
      detection_retention_days: globalSettings.defaultServerSettings.detectionRetentionDays,
    };

    return {
      guild_id: guildId,
      restricted_role_id: null,
      admin_channel_id: null,
      verification_channel_id: null,
      admin_notification_role_id: null,
      heuristic_message_threshold: this.defaultHeuristicSettings.messageThreshold,
      heuristic_message_timeframe_seconds: this.defaultHeuristicSettings.timeWindowMs / 1000,
      heuristic_suspicious_keywords: [...this.defaultHeuristicSettings.suspiciousKeywords],
      updated_by: null,
      is_active: true,
      settings: defaultSettings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private async createDefaultServerConfig(guildId: string): Promise<Server> {
    let existingServer: Server | null = null;

    if (process.env.DATABASE_URL) {
      try {
        existingServer = await this.serverRepository.findByGuildId(guildId);
      } catch (error) {
        console.error(`Failed to fetch existing server config for guild ${guildId}:`, error);
      }
    }

    if (existingServer) {
      return existingServer;
    }

    return this.createDefaultConfig(guildId);
  }

  private formatZodError(error: z.ZodError): string {
    return error.issues
      .map((issue: z.ZodIssue) => {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return `${path}${issue.message}`;
      })
      .join('; ');
  }

  public getCachedServerConfig(guildId: string): Server | undefined {
    return this.serverCache.get(guildId);
  }

  public getCachedHeuristicSettings(guildId: string): HeuristicSettings {
    const cached = this.heuristicSettingsCache.get(guildId);
    if (cached) {
      return cached;
    }

    const cachedServer = this.serverCache.get(guildId);
    if (cachedServer) {
      const computed = this.computeHeuristicSettings(cachedServer);
      this.heuristicSettingsCache.set(guildId, computed);
      return computed;
    }

    return this.defaultHeuristicSettings;
  }

  public async getHeuristicSettings(guildId: string): Promise<HeuristicSettings> {
    await this.getServerConfig(guildId);
    return this.getCachedHeuristicSettings(guildId);
  }

  public async updateHeuristicSettings(
    guildId: string,
    updates: HeuristicSettingsUpdate
  ): Promise<HeuristicSettings> {
    const parsed = HeuristicSettingsUpdateSchema.safeParse(updates);
    if (!parsed.success) {
      throw new Error(this.formatZodError(parsed.error));
    }

    const currentConfig = await this.getServerConfig(guildId);
    const nextThreshold = parsed.data.messageThreshold ?? currentConfig.heuristic_message_threshold;
    const nextTimeframeSeconds =
      parsed.data.timeframeSeconds ?? currentConfig.heuristic_message_timeframe_seconds;
    const nextKeywords =
      parsed.data.suspiciousKeywords !== undefined
        ? this.normalizeKeywords(parsed.data.suspiciousKeywords)
        : this.normalizeKeywords(currentConfig.heuristic_suspicious_keywords);

    await this.updateServerConfig(guildId, {
      heuristic_message_threshold: nextThreshold,
      heuristic_message_timeframe_seconds: nextTimeframeSeconds,
      heuristic_suspicious_keywords: nextKeywords,
    });

    return this.getCachedHeuristicSettings(guildId);
  }

  public async resetHeuristicSettings(guildId: string): Promise<HeuristicSettings> {
    await this.updateServerConfig(guildId, {
      heuristic_message_threshold: this.defaultHeuristicSettings.messageThreshold,
      heuristic_message_timeframe_seconds: this.defaultHeuristicSettings.timeWindowMs / 1000,
      heuristic_suspicious_keywords: [...this.defaultHeuristicSettings.suspiciousKeywords],
    });

    return this.getCachedHeuristicSettings(guildId);
  }

  /**
   * Initialize the configuration service
   * Loads all active servers into cache
   */
  async initialize(): Promise<void> {
    if (process.env.DATABASE_URL) {
      try {
        const servers = await this.serverRepository.findAllActive();
        servers.forEach((server) => {
          this.cacheServerConfig(server);
        });

        console.log(`Loaded ${servers.length} server configurations from database`);
      } catch (error) {
        console.error('Failed to load server configurations from database:', error);
      }
    } else {
      console.warn(
        'DATABASE_URL is not configured. Using environment variables for configuration.'
      );
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
    const cachedServer = this.serverCache.get(guildId);
    if (cachedServer) {
      return cachedServer;
    }

    if (process.env.DATABASE_URL) {
      try {
        const server = await this.serverRepository.findByGuildId(guildId);
        if (server) {
          this.cacheServerConfig(server);
          return server;
        }

        const defaultConfig = this.createDefaultConfig(guildId);
        const configForDb = {
          guild_id: defaultConfig.guild_id,
          restricted_role_id: defaultConfig.restricted_role_id,
          admin_channel_id: defaultConfig.admin_channel_id,
          verification_channel_id: defaultConfig.verification_channel_id,
          admin_notification_role_id: defaultConfig.admin_notification_role_id,
          heuristic_message_threshold: defaultConfig.heuristic_message_threshold,
          heuristic_message_timeframe_seconds: defaultConfig.heuristic_message_timeframe_seconds,
          heuristic_suspicious_keywords: defaultConfig.heuristic_suspicious_keywords,
          is_active: defaultConfig.is_active,
          settings: defaultConfig.settings,
        };

        await this.serverRepository.upsertByGuildId(guildId, configForDb);

        const savedServer = await this.serverRepository.findByGuildId(guildId);
        if (savedServer) {
          this.cacheServerConfig(savedServer);
          return savedServer;
        }

        this.cacheServerConfig(defaultConfig);
        return defaultConfig;
      } catch (error) {
        console.error(`Failed to get server configuration for guild ${guildId}:`, error);
      }
    }

    const defaultConfig = this.createDefaultConfig(guildId);
    this.cacheServerConfig(defaultConfig);
    return defaultConfig;
  }

  /**
   * Update a server configuration
   * @param guildId The Discord guild ID
   * @param data The data to update
   * @returns The updated server configuration
   */
  async updateServerConfig(guildId: string, data: Partial<Server>): Promise<Server> {
    if (process.env.DATABASE_URL) {
      try {
        const server = await this.serverRepository.upsertByGuildId(guildId, data);
        this.cacheServerConfig(server);
        return server;
      } catch (error) {
        console.error(`Failed to update server configuration for guild ${guildId}:`, error);
        throw error instanceof Error
          ? error
          : new Error(`Failed to update server configuration for guild ${guildId}`);
      }
    }

    const currentConfig =
      this.serverCache.get(guildId) || (await this.createDefaultServerConfig(guildId));
    const updatedServer: Server = {
      ...currentConfig,
      ...data,
      updated_at: new Date().toISOString(),
    };

    this.cacheServerConfig(updatedServer);
    return updatedServer;
  }

  /**
   * Update specific settings for a server
   * @param guildId The Discord guild ID
   * @param settings The settings to update
   * @returns The updated server configuration
   */
  async updateServerSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server> {
    const currentConfig = await this.getServerConfig(guildId);
    const updatedSettings: ServerSettings = {
      ...currentConfig.settings,
      ...settings,
    };

    return this.updateServerConfig(guildId, { settings: updatedSettings });
  }

  /**
   * Clear the server cache
   */
  clearCache(): void {
    this.serverCache.clear();
    this.heuristicSettingsCache.clear();
  }
}
