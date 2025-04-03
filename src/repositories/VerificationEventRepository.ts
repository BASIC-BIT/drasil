import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, verification_status } from '@prisma/client'; // Import Prisma types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import { VerificationEvent, VerificationStatus } from './types'; // Use local enum

export interface IVerificationEventRepository {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<VerificationEvent[]>;
  findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null>;
  findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]>;
  createFromDetection(
    detectionEventId: string | null,
    serverId: string, // Explicitly require server/user IDs
    userId: string,   // Explicitly require server/user IDs
    status: VerificationStatus
  ): Promise<VerificationEvent>;
  updateStatus(
    id: string,
    status: VerificationStatus,
    adminId?: string,
    notes?: string
  ): Promise<VerificationEvent | null>; // Return null if not found
  getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]>;
  findById(id: string): Promise<VerificationEvent | null>;
  update(id: string, data: Partial<VerificationEvent>): Promise<VerificationEvent | null>; // Return null if not found
}

@injectable()
export class VerificationEventRepository implements IVerificationEventRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  /**
   * Handle errors from Prisma operations
   */
  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(`Database error during ${operation}: ${error.message} (Code: ${error.code})`, error);
    } else if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    } else {
      throw new RepositoryError(`Unknown error during ${operation}`, error);
    }
  }

  async findById(id: string): Promise<VerificationEvent | null> {
    try {
      const event = await this.prisma.verification_events.findUnique({
        where: { id },
      });
      return event as VerificationEvent | null; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findById');
    }
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<VerificationEvent[]> {
    try {
      const events = await this.prisma.verification_events.findMany({
        where: {
          user_id: userId,
          server_id: serverId,
        },
        orderBy: { created_at: 'desc' },
        take: options.limit,
        skip: options.offset,
      });
      return (events as VerificationEvent[]) || []; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findByUserAndServer');
    }
  }

  async findActiveByUserAndServer(
    userId: string,
    serverId: string
  ): Promise<VerificationEvent | null> {
    try {
      const event = await this.prisma.verification_events.findFirst({
        where: {
          user_id: userId,
          server_id: serverId,
          status: VerificationStatus.PENDING, // Use local enum
        },
        orderBy: { created_at: 'desc' },
      });
      return event as VerificationEvent | null; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findActiveByUserAndServer');
    }
  }

  async findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]> {
    try {
      const events = await this.prisma.verification_events.findMany({
        where: { detection_event_id: detectionEventId },
        orderBy: { created_at: 'desc' },
      });
      return (events as VerificationEvent[]) || []; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'findByDetectionEvent');
    }
  }

  // Modified: Requires serverId and userId explicitly now
  async createFromDetection(
    detectionEventId: string | null,
    serverId: string,
    userId: string,
    status: VerificationStatus
  ): Promise<VerificationEvent> {
    try {
      if (!serverId || !userId) {
        throw new RepositoryError('serverId and userId are required to create a verification event');
      }

      const newEventData: Prisma.verification_eventsCreateInput = {
        servers: { connect: { guild_id: serverId } },
        users: { connect: { discord_id: userId } },
        detection_events_verification_events_detection_event_idTodetection_events: detectionEventId
          ? { connect: { id: detectionEventId } }
          : undefined,
        status: status as verification_status, // Cast to Prisma enum
        metadata: Prisma.JsonNull,
        // created_at, updated_at handled by default
      };

      const created = await this.prisma.verification_events.create({
        data: newEventData,
      });

      // Update the related detection event if applicable
      if (detectionEventId && created) {
        try {
          await this.prisma.detection_events.update({
            where: { id: detectionEventId },
            data: { latest_verification_event_id: created.id },
          });
        } catch (updateError) {
          // Log error but don't fail the verification creation
          console.error(
            `Failed to link verification event ${created.id} to detection event ${detectionEventId}:`,
            updateError
          );
        }
      }

      return created as VerificationEvent; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'createFromDetection');
    }
  }

  async updateStatus(
    id: string,
    status: VerificationStatus,
    adminId?: string,
    notes?: string
  ): Promise<VerificationEvent | null> {
    try {
      const now = new Date();
      const updateData: Prisma.verification_eventsUpdateInput = {
        status: status as verification_status, // Cast to Prisma enum
        updated_at: now,
        notes: notes,
      };

      if (status === VerificationStatus.VERIFIED || status === VerificationStatus.BANNED) {
        updateData.resolved_at = now;
        updateData.resolved_by = adminId;
      } else {
        // Ensure resolved fields are nullified if status changes back to pending
        updateData.resolved_at = null;
        updateData.resolved_by = null;
      }

      const updatedEvent = await this.prisma.verification_events.update({
        where: { id },
        data: updateData,
      });
      return updatedEvent as VerificationEvent | null; // Cast needed if type differs
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update status for non-existent verification event: ${id}`);
        return null;
      }
      this.handleError(error, 'updateStatus');
    }
  }

  async getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]> {
    // Re-implement using findByUserAndServer
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }

  async update(id: string, data: Partial<VerificationEvent>): Promise<VerificationEvent | null> {
    try {
      // Map partial VerificationEvent to Prisma update input
      const updateData: Prisma.verification_eventsUpdateInput = {
        thread_id: data.thread_id,
        notification_message_id: data.notification_message_id,
        notes: data.notes,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined, // Handle potential null/undefined
        updated_at: new Date(), // Always update timestamp
        // Add other updatable fields from VerificationEvent if needed
      };

      const updatedEvent = await this.prisma.verification_events.update({
        where: { id },
        data: updateData,
      });
      return updatedEvent as VerificationEvent | null; // Cast needed if type differs
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        console.warn(`Attempted to update non-existent verification event: ${id}`);
        return null;
      }
      this.handleError(error, 'update');
    }
  }
}
