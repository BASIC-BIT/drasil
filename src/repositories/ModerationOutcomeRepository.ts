import { injectable, inject } from 'inversify';
import {
  moderation_outcome_source,
  moderation_outcome_type,
  Prisma,
  PrismaClient,
} from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  ModerationOutcome,
  ModerationOutcomeCreate,
  ModerationOutcomeSource,
  ModerationOutcomeType,
} from './types';

export interface IModerationOutcomeRepository {
  createOutcome(data: ModerationOutcomeCreate): Promise<ModerationOutcome>;
  findByUserAndServer(
    userId: string,
    serverId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<ModerationOutcome[]>;
  findLatestByTypeForUserAndServer(
    userId: string,
    serverId: string,
    outcomeType: ModerationOutcomeType
  ): Promise<ModerationOutcome | null>;
  findByVerificationEvent(verificationEventId: string): Promise<ModerationOutcome[]>;
}

@injectable()
export class ModerationOutcomeRepository implements IModerationOutcomeRepository {
  constructor(@inject(TYPES.PrismaClient) private prisma: PrismaClient) {}

  private handleError(error: unknown, operation: string): never {
    console.error(`Repository error during ${operation}:`, error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw new RepositoryError(
        `Database error during ${operation}: ${error.message} (Code: ${error.code})`,
        error
      );
    }
    if (error instanceof Error) {
      throw new RepositoryError(`Unexpected error during ${operation}: ${error.message}`, error);
    }
    throw new RepositoryError(`Unknown error during ${operation}`, error);
  }

  async createOutcome(data: ModerationOutcomeCreate): Promise<ModerationOutcome> {
    try {
      const outcomeData: Prisma.moderation_outcomesCreateInput = {
        outcome_type: data.outcome_type as unknown as moderation_outcome_type,
        source: data.source as unknown as moderation_outcome_source,
        actor_id: data.actor_id,
        reason: data.reason,
        occurred_at: data.occurred_at ?? new Date(),
        metadata:
          data.metadata === undefined || data.metadata === null
            ? Prisma.JsonNull
            : (data.metadata as Prisma.InputJsonValue),
        servers: { connect: { guild_id: data.server_id } },
        users: { connect: { discord_id: data.user_id } },
        detection_events: data.detection_event_id
          ? { connect: { id: data.detection_event_id } }
          : undefined,
        verification_events: data.verification_event_id
          ? { connect: { id: data.verification_event_id } }
          : undefined,
      };

      const operationId = (data.metadata as Record<string, unknown> | null)
        ?.report_ban_operation_id;
      if (typeof operationId === 'string') {
        return await this.prisma.$transaction(async (transaction) => {
          // Serialize the check and insert, including cleanup by an expired worker.
          const operation = await transaction.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM moderation_action_requests WHERE id = ${operationId}::uuid FOR UPDATE
          `;
          if (!operation.length) throw new Error('Report ban operation is missing.');
          const existing = await transaction.moderation_outcomes.findFirst({
            where: {
              server_id: data.server_id,
              user_id: data.user_id,
              verification_event_id: data.verification_event_id ?? null,
              outcome_type: data.outcome_type as moderation_outcome_type,
              metadata: { path: ['report_ban_operation_id'], equals: operationId },
            },
          });
          return (existing ??
            (await transaction.moderation_outcomes.create({
              data: outcomeData,
            }))) as ModerationOutcome;
        });
      }

      const createdOutcome = await this.prisma.moderation_outcomes.create({
        data: outcomeData,
      });

      return createdOutcome as ModerationOutcome;
    } catch (error) {
      this.handleError(error, 'createOutcome');
    }
  }

  async findByUserAndServer(
    userId: string,
    serverId: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<ModerationOutcome[]> {
    try {
      const outcomes = await this.prisma.moderation_outcomes.findMany({
        where: {
          user_id: userId,
          server_id: serverId,
        },
        orderBy: { occurred_at: 'desc' },
        take: options.limit,
        skip: options.offset,
      });
      return outcomes as ModerationOutcome[];
    } catch (error) {
      this.handleError(error, 'findByUserAndServer');
    }
  }

  async findLatestByTypeForUserAndServer(
    userId: string,
    serverId: string,
    outcomeType: ModerationOutcomeType
  ): Promise<ModerationOutcome | null> {
    try {
      const outcome = await this.prisma.moderation_outcomes.findFirst({
        where: {
          user_id: userId,
          server_id: serverId,
          outcome_type: outcomeType as unknown as moderation_outcome_type,
        },
        orderBy: { occurred_at: 'desc' },
      });
      return outcome as ModerationOutcome | null;
    } catch (error) {
      this.handleError(error, 'findLatestByTypeForUserAndServer');
    }
  }

  async findByVerificationEvent(verificationEventId: string): Promise<ModerationOutcome[]> {
    try {
      const outcomes = await this.prisma.moderation_outcomes.findMany({
        where: { verification_event_id: verificationEventId },
        orderBy: { occurred_at: 'desc' },
      });
      return outcomes as ModerationOutcome[];
    } catch (error) {
      this.handleError(error, 'findByVerificationEvent');
    }
  }
}

export const MODERATION_OUTCOME_SOURCES = Object.values(ModerationOutcomeSource);
export const MODERATION_OUTCOME_TYPES = Object.values(ModerationOutcomeType);
