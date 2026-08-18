import { injectable, inject } from 'inversify';
import {
  case_attention_state,
  case_containment_status,
  case_kind,
  Prisma,
  PrismaClient,
  verification_status,
} from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  VerificationEvent,
  VerificationStatus,
} from './types'; // Use local enum

export interface IVerificationEventRepository {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<VerificationEvent[]>;
  findActiveByUserAndServer(userId: string, serverId: string): Promise<VerificationEvent | null>;
  findByDetectionEvent(detectionEventId: string): Promise<VerificationEvent[]>;
  findPendingByServer(serverId: string): Promise<VerificationEvent[]>;
  findReviewablePendingByServer(serverId: string): Promise<VerificationEvent[]>;
  findParkedByServer(serverId: string): Promise<VerificationEvent[]>;
  findResolvedWithThreadsByServer(
    serverId: string,
    options?: { days?: number | null; limit?: number | null; userId?: string | null }
  ): Promise<VerificationEvent[]>;
  createFromDetection(
    detectionEventId: string | null,
    serverId: string, // Explicitly require server/user IDs
    userId: string, // Explicitly require server/user IDs
    status: VerificationStatus
  ): Promise<VerificationEvent>;
  getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]>;
  findById(id: string): Promise<VerificationEvent | null>;
  findByThreadId(threadId: string): Promise<VerificationEvent | null>;
  claimQuarantineAttempt(
    id: string,
    serverId: string,
    userId: string,
    staleBefore: Date
  ): Promise<VerificationEvent | null>;
  update(
    id: string,
    data: Partial<VerificationEvent>,
    options?: { touchUpdatedAt?: boolean }
  ): Promise<VerificationEvent | null>; // Return null if not found
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

  async findByThreadId(threadId: string): Promise<VerificationEvent | null> {
    try {
      const event = await this.prisma.verification_events.findFirst({
        where: {
          thread_id: threadId,
          status: VerificationStatus.PENDING,
        },
        orderBy: { created_at: 'desc' },
      });
      return event as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'findByThreadId');
    }
  }

  async claimQuarantineAttempt(
    id: string,
    serverId: string,
    userId: string,
    staleBefore: Date
  ): Promise<VerificationEvent | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.verification_events.updateMany({
          where: {
            id,
            server_id: serverId,
            user_id: userId,
            status: VerificationStatus.PENDING,
            attention_state: CaseAttentionState.REVIEW_REQUIRED,
            OR: [
              { containment_status: { not: CaseContainmentStatus.IN_PROGRESS } },
              { updated_at: { lte: staleBefore } },
            ],
          },
          data: {
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            updated_at: new Date(),
          },
        });
        if (claimed.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'claimQuarantineAttempt');
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
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return events as VerificationEvent[];
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
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return events as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findByDetectionEvent');
    }
  }

  async findPendingByServer(serverId: string): Promise<VerificationEvent[]> {
    try {
      const events = await this.prisma.verification_events.findMany({
        where: {
          server_id: serverId,
          status: VerificationStatus.PENDING,
        },
        orderBy: { updated_at: 'asc' },
      });
      return events as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findPendingByServer');
    }
  }

  async findReviewablePendingByServer(serverId: string): Promise<VerificationEvent[]> {
    try {
      const events = await this.prisma.verification_events.findMany({
        where: {
          server_id: serverId,
          status: VerificationStatus.PENDING,
          attention_state: CaseAttentionState.REVIEW_REQUIRED,
        },
        orderBy: { updated_at: 'asc' },
      });
      return events as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findReviewablePendingByServer');
    }
  }

  async findParkedByServer(serverId: string): Promise<VerificationEvent[]> {
    try {
      const events = await this.prisma.verification_events.findMany({
        where: {
          server_id: serverId,
          status: VerificationStatus.PENDING,
          attention_state: CaseAttentionState.PARKED,
        },
        orderBy: { parked_at: 'desc' },
      });
      return events as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findParkedByServer');
    }
  }

  async findResolvedWithThreadsByServer(
    serverId: string,
    options: { days?: number | null; limit?: number | null; userId?: string | null } = {}
  ): Promise<VerificationEvent[]> {
    try {
      const days = Math.max(1, Math.min(options.days ?? 30, 365));
      const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const events = await this.prisma.verification_events.findMany({
        where: {
          server_id: serverId,
          ...(options.userId ? { user_id: options.userId } : {}),
          status: {
            in: [
              VerificationStatus.VERIFIED,
              VerificationStatus.BANNED,
              VerificationStatus.KICKED,
              VerificationStatus.CLOSED_NO_ACTION,
            ],
          },
          updated_at: { gte: since },
          OR: [{ thread_id: { not: null } }, { private_evidence_thread_id: { not: null } }],
        },
        orderBy: { updated_at: 'desc' },
        take: limit,
      });
      return events as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findResolvedWithThreadsByServer');
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
        throw new RepositoryError(
          'serverId and userId are required to create a verification event'
        );
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
      // If prisma.create fails, it throws an error caught by the outer try/catch.
      // If it succeeds, 'created' is guaranteed to be truthy.
      if (detectionEventId) {
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

  async getVerificationHistory(userId: string, serverId: string): Promise<VerificationEvent[]> {
    // Re-implement using findByUserAndServer
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }

  async update(
    id: string,
    data: Partial<VerificationEvent>,
    options: { touchUpdatedAt?: boolean } = {}
  ): Promise<VerificationEvent | null> {
    try {
      const now = new Date();
      // Map partial VerificationEvent to Prisma update input
      const updateData: Prisma.verification_eventsUpdateInput = {
        // Existing fields
        thread_id: data.thread_id,
        private_evidence_thread_id: data.private_evidence_thread_id,
        notification_channel_id: data.notification_channel_id,
        notification_message_id: data.notification_message_id,
        case_kind: data.case_kind as case_kind | undefined,
        attention_state: data.attention_state as case_attention_state | undefined,
        containment_status: data.containment_status as case_containment_status | undefined,
        parked_at: data.parked_at,
        parked_by: data.parked_by,
        review_after: data.review_after,
        notes: data.notes,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- data.metadata can be null or undefined
        metadata: (data.metadata as Prisma.InputJsonValue) ?? undefined, // Handle potential null/undefined
        updated_at: options.touchUpdatedAt === false ? data.updated_at : now,
      };

      // Handle status and resolution fields if provided
      if (data.status !== undefined) {
        updateData.status = data.status as verification_status; // Cast to Prisma enum

        if (
          data.status === VerificationStatus.VERIFIED ||
          data.status === VerificationStatus.BANNED ||
          data.status === VerificationStatus.KICKED ||
          data.status === VerificationStatus.CLOSED_NO_ACTION
        ) {
          // Set resolution fields if status is resolved
          updateData.resolved_at = data.resolved_at instanceof Date ? data.resolved_at : now; // Use provided date or now
          updateData.resolved_by = data.resolved_by; // Use provided admin ID
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- This check is necessary
        } else if (data.status === VerificationStatus.PENDING) {
          // Nullify resolution fields if status is pending
          updateData.resolved_at = null;
          updateData.resolved_by = null;
        }
      }

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
