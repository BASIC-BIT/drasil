import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient } from '@prisma/client'; // Import PrismaClient and generated types
import { Server, ServerSettings } from './types'; // Keep existing domain types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError for consistency

/**
 * Interface for the ServerRepository (Remains the same)
 */
export interface IServerRepository {
  findById(id: string): Promise<Server | null>;
  findByGuildId(guildId: string): Promise<Server | null>;
  upsertByGuildId(guildId: string, data: Partial<Server>): Promise<Server>;
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
      // Cast settings field correctly on return
      if (server) {
        return {
          ...server,
          settings: (server.settings as unknown as ServerSettings | null) ?? null,
        } as Server;
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
      // Cast settings field correctly on return
      if (server) {
        return {
          ...server,
          settings: (server.settings as unknown as ServerSettings | null) ?? null,
        } as Server;
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
        settings: (data.settings as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        restricted_role_id: data.restricted_role_id,
        admin_channel_id: data.admin_channel_id,
        verification_channel_id: data.verification_channel_id,
        admin_notification_role_id: data.admin_notification_role_id,
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

      // Cast settings field correctly on return
      return {
        ...upserted,
        settings: (upserted.settings as unknown as ServerSettings | null) ?? null,
      } as Server;
    } catch (error) {
      this.handleError(error, 'upsertByGuildId');
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
      const currentSettings = (server.settings || {}) as ServerSettings;
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

      // Cast settings field correctly on return
      // Cast settings field correctly on return
      return {
        ...updatedServer,
        settings: (updatedServer.settings as unknown as ServerSettings | null) ?? null,
      } as Server | null;
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
      // Cast settings field correctly on return
      // Cast settings field correctly on return
      return {
        ...updatedServer,
        settings: (updatedServer.settings as unknown as ServerSettings | null) ?? null,
      } as Server | null;
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
      // Cast settings field correctly for each server in the array
      // Cast settings field correctly for each server in the array
      return (
        servers.map(
          (server) =>
            ({
              ...server,
              settings: (server.settings as unknown as ServerSettings | null) ?? null,
            }) as Server
        ) || []
      );
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
