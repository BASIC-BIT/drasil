import { injectable, inject } from 'inversify';
import { Prisma, PrismaClient, admin_action_type, verification_status } from '@prisma/client'; // Import Prisma types
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import { AdminAction, AdminActionCreate } from './types'; // Use local types

export interface IAdminActionRepository {
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByAdmin(
    adminId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<AdminAction[]>;
  findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]>;
  createAction(data: AdminActionCreate): Promise<AdminAction>;
  getActionHistory(userId: string, serverId: string): Promise<AdminAction[]>;
}

@injectable()
export class AdminActionRepository implements IAdminActionRepository {
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

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    try {
      const actions = await this.prisma.admin_actions.findMany({
        where: {
          user_id: userId,
          server_id: serverId,
        },
        orderBy: { action_at: 'desc' },
        take: options.limit,
        skip: options.offset,
      });
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return actions as AdminAction[];
    } catch (error) {
      this.handleError(error, 'findByUserAndServer');
    }
  }

  async findByAdmin(
    adminId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<AdminAction[]> {
    try {
      const actions = await this.prisma.admin_actions.findMany({
        where: { admin_id: adminId },
        orderBy: { action_at: 'desc' },
        take: options.limit,
        skip: options.offset,
      });
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return actions as AdminAction[];
    } catch (error) {
      this.handleError(error, 'findByAdmin');
    }
  }

  async findByVerificationEvent(verificationEventId: string): Promise<AdminAction[]> {
    try {
      const actions = await this.prisma.admin_actions.findMany({
        where: { verification_event_id: verificationEventId },
        orderBy: { action_at: 'desc' },
      });
      // findMany always returns an array, which is truthy. The `|| []` is unnecessary.
      return actions as AdminAction[];
    } catch (error) {
      this.handleError(error, 'findByVerificationEvent');
    }
  }

  async createAction(data: AdminActionCreate): Promise<AdminAction> {
    try {
      // Map AdminActionCreate to Prisma input type
      const actionData: Prisma.admin_actionsCreateInput = {
        admin_id: data.admin_id,
        action_type: data.action_type as admin_action_type, // Cast to Prisma enum
        previous_status: data.previous_status as verification_status | null, // Cast to Prisma enum
        new_status: data.new_status as verification_status | null, // Cast to Prisma enum
        notes: data.notes,
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- metadata can be null or undefined
        metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        // Connect relations
        servers: data.server_id ? { connect: { guild_id: data.server_id } } : undefined,
        users: data.user_id ? { connect: { discord_id: data.user_id } } : undefined,
        verification_events: data.verification_event_id
          ? { connect: { id: data.verification_event_id } }
          : undefined,
        detection_events: data.detection_event_id
          ? { connect: { id: data.detection_event_id } }
          : undefined,
        // action_at handled by default
      };

      const createdAction = await this.prisma.admin_actions.create({
        data: actionData,
      });

      return createdAction as AdminAction; // Cast needed if type differs
    } catch (error) {
      this.handleError(error, 'createAction');
    }
  }

  async getActionHistory(userId: string, serverId: string): Promise<AdminAction[]> {
    // Re-implement using findByUserAndServer
    return this.findByUserAndServer(userId, serverId, { limit: 100 });
  }
}
