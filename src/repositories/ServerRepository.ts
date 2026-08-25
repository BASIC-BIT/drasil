import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient } from '../db/prisma';
import { Server, ServerSettings } from './types'; // Keep existing domain types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError for consistency

export interface ServerSetupConfigurationUpdate {
  readonly caseRoleId: string;
  readonly adminChannelId: string;
  readonly verificationChannelId: string;
  readonly settingsPatch: Partial<ServerSettings>;
}

interface ServerDatabaseRecord {
  readonly guild_id: string;
  readonly case_role_id: string | null;
  readonly admin_channel_id: string | null;
  readonly verification_channel_id: string | null;
  readonly admin_notification_role_id: string | null;
  readonly heuristic_message_threshold: number;
  readonly heuristic_message_timeframe_seconds: number;
  readonly heuristic_suspicious_keywords: string[];
  readonly created_at: Date | null;
  readonly updated_at: Date | null;
  readonly updated_by: string | null;
  readonly settings: Prisma.JsonValue | null;
  readonly is_active: boolean | null;
}

/**
 * Interface for the ServerRepository (Remains the same)
 */
export interface IServerRepository {
  findById(id: string): Promise<Server | null>;
  findByGuildId(guildId: string): Promise<Server | null>;
  upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server>;
  upsertSetupConfiguration(
    guildId: string,
    update: ServerSetupConfigurationUpdate
  ): Promise<Server>;
  updateSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null>;
  setActive(guildId: string, isActive: boolean): Promise<Server | null>;
  findAllActive(): Promise<Server[]>;
  getOrCreateServer(guildId: string): Promise<Server>;
}

/**
 * Repository for managing server/guild configurations using Prisma
 */
@injectable()
export class ServerRepository implements IServerRepository {
  // Inject PrismaClient instead of SupabaseClient
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private toDomainServer(server: ServerDatabaseRecord): Server {
    return {
      guild_id: server.guild_id,
      case_role_id: server.case_role_id,
      admin_channel_id: server.admin_channel_id,
      verification_channel_id: server.verification_channel_id,
      admin_notification_role_id: server.admin_notification_role_id,
      heuristic_message_threshold: server.heuristic_message_threshold,
      heuristic_message_timeframe_seconds: server.heuristic_message_timeframe_seconds,
      heuristic_suspicious_keywords: [...server.heuristic_suspicious_keywords],
      created_at: server.created_at ? server.created_at.toISOString() : null,
      updated_at: server.updated_at ? server.updated_at.toISOString() : null,
      updated_by: server.updated_by,
      settings: (server.settings as unknown as ServerSettings | null) ?? {},
      is_active: server.is_active ?? true,
    };
  }

  /**
   * Handle errors from Prisma operations
   */
  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // Handle specific Prisma errors if needed, e.g., P2025 for not found
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    } else if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    } else {
      throw new RepositoryError(`Unknown error during ${operation}`, error);
    }
  }

  /**
   * Find a server by ID
   */
  async findById(id: string): Promise<Server | null> {
    try {
      // Correct: Use guild_id as the unique identifier
      const server = await this.prisma.servers.findUnique({
        where: { guild_id: id }, // Use the 'id' parameter which corresponds to guild_id
      });
      // Prisma returns null directly if not found
      if (server) {
        return this.toDomainServer(server);
      }
      return null;
    } catch (error) {
      this.handleError(error, 'findById');
    }
  }

  /**
   * Find a server by Discord guild ID
   */
  async findByGuildId(guildId: string): Promise<Server | null> {
    try {
      const server = await this.prisma.servers.findUnique({
        where: { guild_id: guildId },
      });
      // Prisma returns null directly if not found
      if (server) {
        return this.toDomainServer(server);
      }
      return null;
    } catch (error) {
      this.handleError(error, 'findByGuildId');
    }
  }

  /**
   * Create or update a server configuration
   */
  async upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server> {
    try {
      // Prisma's upsert handles create vs update logic
      const serverData = {
        guild_id: guildId,
        is_active: data.is_active ?? true,
        // Cast settings to unknown then JsonValue for Prisma input
        // data.settings should always be an object based on the Server interface,
        // so the ?? fallback is unnecessary.
        settings: data.settings as unknown as Prisma.InputJsonValue,
        case_role_id: data.case_role_id,
        admin_channel_id: data.admin_channel_id,
        verification_channel_id: data.verification_channel_id,
        admin_notification_role_id: data.admin_notification_role_id,
        heuristic_message_threshold: data.heuristic_message_threshold,
        heuristic_message_timeframe_seconds: data.heuristic_message_timeframe_seconds,
        heuristic_suspicious_keywords: data.heuristic_suspicious_keywords,
        // created_at is handled by default in schema
        updated_at: new Date(), // Prisma handles timestamp updates
      };

      const upserted = await this.prisma.servers.upsert({
        where: { guild_id: guildId },
        create: {
          ...serverData,
          // created_at will use the database default
        },
        update: {
          ...serverData,
          // Do not overwrite created_at on update
          created_at: undefined,
        },
      });

      return this.toDomainServer(upserted);
    } catch (error) {
      this.handleError(error, 'upsertByGuildId');
    }
  }

  async upsertSetupConfiguration(
    guildId: string,
    update: ServerSetupConfigurationUpdate
  ): Promise<Server> {
    try {
      const settingsPatch = JSON.stringify(update.settingsPatch);
      const rows = await this.prisma.$queryRaw<ServerDatabaseRecord[]>(Prisma.sql`
        insert into servers (
          guild_id,
          case_role_id,
          admin_channel_id,
          verification_channel_id,
          settings,
          updated_at
        ) values (
          ${guildId},
          ${update.caseRoleId},
          ${update.adminChannelId},
          ${update.verificationChannelId},
          ${settingsPatch}::jsonb,
          now()
        )
        on conflict (guild_id) do update set
          case_role_id = excluded.case_role_id,
          admin_channel_id = excluded.admin_channel_id,
          verification_channel_id = excluded.verification_channel_id,
          settings = coalesce(servers.settings, '{}'::jsonb) || excluded.settings,
          updated_at = now()
        returning
          guild_id,
          case_role_id,
          admin_channel_id,
          verification_channel_id,
          admin_notification_role_id,
          heuristic_message_threshold,
          heuristic_message_timeframe_seconds,
          heuristic_suspicious_keywords,
          created_at,
          updated_at,
          updated_by,
          settings,
          is_active
      `);
      const server = rows.at(0);
      if (!server) {
        throw new Error(`Setup configuration upsert returned no server for ${guildId}`);
      }
      return this.toDomainServer(server);
    } catch (error) {
      this.handleError(error, 'upsertSetupConfiguration');
    }
  }

  /**
   * Update specific settings for a server
   */
  async updateSettings(guildId: string, settings: Partial<ServerSettings>): Promise<Server | null> {
    try {
      const server = await this.findByGuildId(guildId);
      if (!server) return null;

      // Merge existing settings with new ones
      // server.settings is guaranteed to be an object by the Server interface,
      // so the `|| {}` fallback is unnecessary.
      const currentSettings = server.settings as ServerSettings;
      const updatedSettings = {
        ...currentSettings,
        ...settings,
      };

      const updatedServer = await this.prisma.servers.update({
        where: { guild_id: guildId },
        data: {
          // Cast settings to unknown then JsonValue for Prisma input
          settings: updatedSettings as unknown as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });

      return this.toDomainServer(updatedServer);
    } catch (error) {
      // Handle potential "not found" error during update (P2025)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update settings for non-existent server: ${guildId}`);
        return null;
      }
      this.handleError(error, 'updateSettings');
    }
  }

  /**
   * Mark a server as active or inactive
   */
  async setActive(guildId: string, isActive: boolean): Promise<Server | null> {
    try {
      const updatedServer = await this.prisma.servers.update({
        where: { guild_id: guildId },
        data: {
          is_active: isActive,
          updated_at: new Date(),
        },
      });
      return this.toDomainServer(updatedServer);
    } catch (error) {
      // Handle potential "not found" error during update (P2025)
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to set active status for non-existent server: ${guildId}`);
        return null;
      }
      this.handleError(error, 'setActive');
    }
  }

  /**
   * Get all active server configurations
   */
  async findAllActive(): Promise<Server[]> {
    try {
      const servers = await this.prisma.servers.findMany({
        where: { is_active: true },
      });
      return servers.map((server: (typeof servers)[number]) => this.toDomainServer(server));
    } catch (error) {
      this.handleError(error, 'findAllActive');
    }
  }

  /**
   * Get an existing server by Discord guild ID or create a new one
   */
  public async getOrCreateServer(guildId: string): Promise<Server> {
    // findByGuildId already handles errors internally
    const server = await this.findByGuildId(guildId);

    if (server) {
      return server;
    }

    // upsertByGuildId handles errors internally
    // Create new server with default settings
    return await this.upsertByGuildId(guildId, {
      // Defaults are handled within upsertByGuildId's create logic
    });
  }
}
