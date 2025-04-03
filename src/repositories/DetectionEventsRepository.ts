import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, detection_type } from '@prisma/client'; // Import PrismaClient and generated types
import { DetectionEvent } from './types'; // Keep existing domain types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository'; // Keep using RepositoryError

/**
 * Interface for Detection Events Repository (Remains the same)
 */
export interface IDetectionEventsRepository {
  create(data: Partial<DetectionEvent>): Promise<DetectionEvent>;
  findByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]>;
  findRecentByServer(serverId: string, limit?: number): Promise<DetectionEvent[]>;
  recordAdminAction(
    id: string,
    action: 'Verified' | 'Banned' | 'Ignored', // Keep string literal type for now
    adminId: string
  ): Promise<DetectionEvent | null>;
  cleanupOldEvents(retentionDays: number): Promise<number>;
  findById(id: string): Promise<DetectionEvent | null>; // Add findById for consistency
}

/**
 * Repository for managing detection events using Prisma
 */
@injectable()
export class DetectionEventsRepository implements IDetectionEventsRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  /**
   * Handle errors from Prisma operations
   */
  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
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
   * Find a detection event by its ID
   */
  async findById(id: string): Promise<DetectionEvent | null> {
    try {
      const event = await this.prisma.detection_events.findUnique({
        where: { id },
      });
      return event as DetectionEvent | null; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findById');
    }
  }

  /**
   * Create a new detection event
   */
  async create(data: Partial<DetectionEvent>): Promise<DetectionEvent> {
    try {
      if (
        !data.server_id ||
        !data.user_id ||
        !data.detection_type ||
        data.confidence === undefined
      ) {
        throw new Error(
          'server_id, user_id, detection_type, and confidence are required to create a detection event'
        );
      }

      const eventData: Prisma.detection_eventsCreateInput = {
        // Use Prisma relations for server and user if IDs are UUIDs, otherwise use direct IDs
        servers: data.server_id ? { connect: { guild_id: data.server_id } } : undefined,
        users: data.user_id ? { connect: { discord_id: data.user_id } } : undefined,
        detection_type: data.detection_type as detection_type, // Cast to Prisma enum
        confidence: data.confidence,
        reasons: data.reasons ?? [],
        message_id: data.message_id,
        channel_id: data.channel_id,
        thread_id: data.thread_id,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        // detected_at is handled by default
      };

      const created = await this.prisma.detection_events.create({
        data: eventData,
      });

      return created as DetectionEvent; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'create');
    }
  }

  /**
   * Find detection events for a specific user in a server
   */
  async findByServerAndUser(serverId: string, userId: string): Promise<DetectionEvent[]> {
    try {
      const events = await this.prisma.detection_events.findMany({
        where: {
          server_id: serverId,
          user_id: userId,
        },
        orderBy: {
          detected_at: 'desc',
        },
      });
      return (events as DetectionEvent[]) || []; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findByServerAndUser');
    }
  }

  /**
   * Find recent detection events for a server
   */
  async findRecentByServer(serverId: string, limit: number = 50): Promise<DetectionEvent[]> {
    try {
      const events = await this.prisma.detection_events.findMany({
        where: { server_id: serverId },
        orderBy: { detected_at: 'desc' },
        take: limit,
      });
      return (events as DetectionEvent[]) || []; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findRecentByServer');
    }
  }

  /**
   * Record an admin action on a detection event
   */
  async recordAdminAction(
    id: string,
    action: 'Verified' | 'Banned' | 'Ignored',
    adminId: string
  ): Promise<DetectionEvent | null> {
    try {
      const updatedEvent = await this.prisma.detection_events.update({
        where: { id },
        data: {
          admin_action: action,
          admin_action_by: adminId,
          admin_action_at: new Date(),
        },
      });
      return updatedEvent as DetectionEvent | null; // Cast needed if type differs
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to record admin action on non-existent detection event: ${id}`);
        return null;
      }
      this.handleError(error, 'recordAdminAction');
    }
  }

  /**
   * Clean up old detection events based on retention policy
   */
  async cleanupOldEvents(retentionDays: number): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await this.prisma.detection_events.deleteMany({
        where: {
          detected_at: {
            lt: cutoffDate,
          },
        },
      });

      return result.count;
    } catch (error) {
      this.handleError(error, 'cleanupOldEvents');
    }
  }
}
