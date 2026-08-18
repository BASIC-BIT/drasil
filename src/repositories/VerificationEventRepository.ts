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
  CaseKind,
  VerificationEvent,
  VerificationStatus,
} from './types'; // Use local enum
import {
  CASE_ATTENTION_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_ATTEMPT_PREFIX,
  CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
  CASE_TERMINAL_ACTION_ATTEMPT_PREFIX,
} from '../utils/caseRoleRelease';

export interface VerificationReleaseCompletion {
  id: string;
  metadata: VerificationEvent['metadata'];
  requiresCaseRoleReleaseClaim: boolean;
}

class VerificationReleaseConflictError extends Error {}
class TerminalActionClaimConflictError extends Error {}

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
  findExpiredCaseRoleReleases(staleBefore: Date): Promise<VerificationEvent[]>;
  findExpiredQuarantineAttempts(staleBefore: Date): Promise<VerificationEvent[]>;
  markParkedContainmentIncomplete(
    id: string,
    metadata: VerificationEvent['metadata']
  ): Promise<VerificationEvent | null>;
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
    attemptId: string,
    staleBefore: Date
  ): Promise<VerificationEvent | null>;
  claimCaseRoleRelease(
    id: string,
    serverId: string,
    userId: string,
    attemptId: string,
    staleBefore: Date
  ): Promise<VerificationEvent | null>;
  claimParkedAttention(
    id: string,
    serverId: string,
    userId: string,
    attemptId: string
  ): Promise<VerificationEvent | null>;
  claimTerminalActions(
    ids: readonly string[],
    serverId: string,
    userId: string,
    attemptId: string
  ): Promise<VerificationEvent[] | null>;
  completeCaseRoleRelease(
    id: string,
    attemptId: string,
    resolvedBy: string,
    resolvedAt: Date,
    metadata: VerificationEvent['metadata']
  ): Promise<VerificationEvent | null>;
  completeVerificationRelease(
    completions: readonly VerificationReleaseCompletion[],
    attemptId: string,
    resolvedBy: string,
    resolvedAt: Date
  ): Promise<VerificationEvent[] | null>;
  rollbackCaseRoleRelease(id: string, attemptId: string): Promise<VerificationEvent | null>;
  renewQuarantineAttempt(id: string, attemptId: string): Promise<boolean>;
  recordQuarantineCaseRole(id: string, attemptId: string, roleId: string): Promise<boolean>;
  recoverExpiredQuarantineAttempt(
    id: string,
    attemptId: string,
    staleBefore: Date,
    data: Partial<VerificationEvent>
  ): Promise<VerificationEvent | null>;
  updateQuarantineAttempt(
    id: string,
    attemptId: string,
    data: Partial<VerificationEvent>
  ): Promise<VerificationEvent | null>;
  update(
    id: string,
    data: Partial<VerificationEvent>,
    options?: {
      touchUpdatedAt?: boolean;
      /** Only for persisting a Discord ban or kick that has already succeeded. */
      allowQuarantineOverride?: boolean;
      /** Only for rolling back a failed Discord action to an exact prior pending state. */
      preservePendingCaseState?: boolean;
      /** Requires an exact terminal-action claim before persisting a Discord side effect. */
      expectedQuarantineAttemptId?: string;
    }
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
    attemptId: string,
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
              { quarantine_lease_renewed_at: null },
              { quarantine_lease_renewed_at: { lte: staleBefore } },
            ],
          },
          data: {
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
            quarantine_lease_renewed_at: new Date(),
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

  async claimCaseRoleRelease(
    id: string,
    serverId: string,
    userId: string,
    attemptId: string,
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
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            attention_state: CaseAttentionState.PARKED,
            OR: [
              {
                containment_status: CaseContainmentStatus.CONTAINED,
                quarantine_attempt_id: null,
              },
              {
                containment_status: CaseContainmentStatus.IN_PROGRESS,
                AND: [
                  {
                    OR: [
                      { quarantine_attempt_id: { startsWith: CASE_ROLE_RELEASE_ATTEMPT_PREFIX } },
                      {
                        quarantine_attempt_id: {
                          startsWith: CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
                        },
                      },
                    ],
                  },
                  {
                    OR: [
                      { quarantine_lease_renewed_at: null },
                      { quarantine_lease_renewed_at: { lte: staleBefore } },
                    ],
                  },
                ],
              },
            ],
          },
          data: {
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
            quarantine_lease_renewed_at: new Date(),
            updated_at: new Date(),
          },
        });
        if (claimed.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'claimCaseRoleRelease');
    }
  }

  async claimParkedAttention(
    id: string,
    serverId: string,
    userId: string,
    attemptId: string
  ): Promise<VerificationEvent | null> {
    if (!attemptId.startsWith(CASE_ATTENTION_ATTEMPT_PREFIX)) {
      throw new RepositoryError('Parked attention claims require an attention attempt ID.');
    }
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.verification_events.updateMany({
          where: {
            id,
            server_id: serverId,
            user_id: userId,
            status: VerificationStatus.PENDING,
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            attention_state: CaseAttentionState.PARKED,
            containment_status: CaseContainmentStatus.CONTAINED,
            quarantine_attempt_id: null,
          },
          data: {
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
            quarantine_lease_renewed_at: new Date(),
            updated_at: new Date(),
          },
        });
        if (claimed.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'claimParkedAttention');
    }
  }

  async claimTerminalActions(
    ids: readonly string[],
    serverId: string,
    userId: string,
    attemptId: string
  ): Promise<VerificationEvent[] | null> {
    if (!attemptId.startsWith(CASE_TERMINAL_ACTION_ATTEMPT_PREFIX) || ids.length === 0) {
      throw new RepositoryError(
        'Terminal-action claims require case IDs and a terminal attempt ID.'
      );
    }
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.verification_events.updateMany({
          where: {
            id: { in: [...ids] },
            server_id: serverId,
            user_id: userId,
            status: VerificationStatus.PENDING,
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            attention_state: CaseAttentionState.PARKED,
            containment_status: CaseContainmentStatus.CONTAINED,
            quarantine_attempt_id: null,
          },
          data: {
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
            quarantine_lease_renewed_at: new Date(),
            updated_at: new Date(),
          },
        });
        if (claimed.count !== ids.length) {
          throw new TerminalActionClaimConflictError();
        }
        const events = await transaction.verification_events.findMany({
          where: { id: { in: [...ids] } },
        });
        const byId = new Map(events.map((event) => [event.id, event]));
        return ids.map((id) => byId.get(id) as VerificationEvent);
      })) as VerificationEvent[];
    } catch (error) {
      if (error instanceof TerminalActionClaimConflictError) {
        return null;
      }
      this.handleError(error, 'claimTerminalActions');
    }
  }

  async completeCaseRoleRelease(
    id: string,
    attemptId: string,
    resolvedBy: string,
    resolvedAt: Date,
    metadata: VerificationEvent['metadata']
  ): Promise<VerificationEvent | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const completed = await transaction.verification_events.updateMany({
          where: {
            id,
            status: VerificationStatus.PENDING,
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            attention_state: CaseAttentionState.PARKED,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
          },
          data: {
            status: VerificationStatus.VERIFIED,
            resolved_by: resolvedBy,
            resolved_at: resolvedAt,
            attention_state: CaseAttentionState.REVIEW_REQUIRED,
            containment_status: CaseContainmentStatus.NOT_APPLICABLE,
            quarantine_attempt_id: null,
            quarantine_lease_renewed_at: null,
            parked_at: null,
            parked_by: null,
            metadata: metadata as Prisma.InputJsonValue,
            updated_at: new Date(),
          },
        });
        if (completed.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'completeCaseRoleRelease');
    }
  }

  async completeVerificationRelease(
    completions: readonly VerificationReleaseCompletion[],
    attemptId: string,
    resolvedBy: string,
    resolvedAt: Date
  ): Promise<VerificationEvent[] | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        for (const completion of completions) {
          const completed = await transaction.verification_events.updateMany({
            where: {
              id: completion.id,
              status: VerificationStatus.PENDING,
              ...(completion.requiresCaseRoleReleaseClaim
                ? {
                    case_kind: CaseKind.COMPROMISED_ACCOUNT,
                    attention_state: CaseAttentionState.PARKED,
                    containment_status: CaseContainmentStatus.IN_PROGRESS,
                    quarantine_attempt_id: attemptId,
                  }
                : {
                    containment_status: { not: CaseContainmentStatus.IN_PROGRESS },
                  }),
            },
            data: {
              status: VerificationStatus.VERIFIED,
              resolved_by: resolvedBy,
              resolved_at: resolvedAt,
              attention_state: CaseAttentionState.REVIEW_REQUIRED,
              containment_status: CaseContainmentStatus.NOT_APPLICABLE,
              quarantine_attempt_id: null,
              quarantine_lease_renewed_at: null,
              parked_at: null,
              parked_by: null,
              metadata: completion.metadata as Prisma.InputJsonValue,
              updated_at: new Date(),
            },
          });
          if (completed.count !== 1) {
            throw new VerificationReleaseConflictError();
          }
        }

        const completedEvents = await transaction.verification_events.findMany({
          where: { id: { in: completions.map((completion) => completion.id) } },
        });
        const completedById = new Map(completedEvents.map((event) => [event.id, event]));
        return completions.map(
          (completion) => completedById.get(completion.id) as VerificationEvent
        );
      })) as VerificationEvent[];
    } catch (error) {
      if (error instanceof VerificationReleaseConflictError) {
        return null;
      }
      this.handleError(error, 'completeVerificationRelease');
    }
  }

  async rollbackCaseRoleRelease(id: string, attemptId: string): Promise<VerificationEvent | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const rolledBack = await transaction.verification_events.updateMany({
          where: {
            id,
            status: VerificationStatus.PENDING,
            case_kind: CaseKind.COMPROMISED_ACCOUNT,
            attention_state: CaseAttentionState.PARKED,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
          },
          data: {
            containment_status: CaseContainmentStatus.CONTAINED,
            quarantine_attempt_id: null,
            quarantine_lease_renewed_at: null,
            updated_at: new Date(),
          },
        });
        if (rolledBack.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'rollbackCaseRoleRelease');
    }
  }

  async renewQuarantineAttempt(id: string, attemptId: string): Promise<boolean> {
    try {
      const renewed = await this.prisma.verification_events.updateMany({
        where: {
          id,
          status: VerificationStatus.PENDING,
          containment_status: CaseContainmentStatus.IN_PROGRESS,
          quarantine_attempt_id: attemptId,
        },
        data: { quarantine_lease_renewed_at: new Date() },
      });
      return renewed.count === 1;
    } catch (error) {
      this.handleError(error, 'renewQuarantineAttempt');
    }
  }

  async recordQuarantineCaseRole(id: string, attemptId: string, roleId: string): Promise<boolean> {
    try {
      const updated = await this.prisma.verification_events.updateMany({
        where: {
          id,
          status: VerificationStatus.PENDING,
          containment_status: CaseContainmentStatus.IN_PROGRESS,
          quarantine_attempt_id: attemptId,
        },
        data: {
          quarantine_case_role_id: roleId,
          quarantine_lease_renewed_at: new Date(),
          updated_at: new Date(),
        },
      });
      return updated.count === 1;
    } catch (error) {
      this.handleError(error, 'recordQuarantineCaseRole');
    }
  }

  async recoverExpiredQuarantineAttempt(
    id: string,
    attemptId: string,
    staleBefore: Date,
    data: Partial<VerificationEvent>
  ): Promise<VerificationEvent | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const recovered = await transaction.verification_events.updateMany({
          where: {
            id,
            status: VerificationStatus.PENDING,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
            OR: [
              { quarantine_lease_renewed_at: null },
              { quarantine_lease_renewed_at: { lte: staleBefore } },
            ],
          },
          data: {
            attention_state: data.attention_state as case_attention_state | undefined,
            containment_status: data.containment_status as case_containment_status | undefined,
            quarantine_attempt_id: null,
            quarantine_lease_renewed_at: null,
            parked_at: data.parked_at,
            parked_by: data.parked_by,
            metadata: data.metadata as Prisma.InputJsonValue | undefined,
            updated_at: new Date(),
          },
        });
        if (recovered.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'recoverExpiredQuarantineAttempt');
    }
  }

  async updateQuarantineAttempt(
    id: string,
    attemptId: string,
    data: Partial<VerificationEvent>
  ): Promise<VerificationEvent | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.verification_events.updateMany({
          where: {
            id,
            status: VerificationStatus.PENDING,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: attemptId,
          },
          data: {
            case_kind: data.case_kind as case_kind | undefined,
            attention_state: data.attention_state as case_attention_state | undefined,
            containment_status: data.containment_status as case_containment_status | undefined,
            quarantine_attempt_id: null,
            quarantine_lease_renewed_at: null,
            parked_at: data.parked_at,
            parked_by: data.parked_by,
            quarantine_case_role_id: data.quarantine_case_role_id,
            metadata: data.metadata as Prisma.InputJsonValue | undefined,
            updated_at: new Date(),
          },
        });
        if (updated.count !== 1) {
          return null;
        }
        return await transaction.verification_events.findUnique({ where: { id } });
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'updateQuarantineAttempt');
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

  async findExpiredCaseRoleReleases(staleBefore: Date): Promise<VerificationEvent[]> {
    try {
      return (await this.prisma.verification_events.findMany({
        where: {
          status: VerificationStatus.PENDING,
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          attention_state: CaseAttentionState.PARKED,
          containment_status: CaseContainmentStatus.IN_PROGRESS,
          AND: [
            {
              OR: [
                { quarantine_attempt_id: { startsWith: CASE_ROLE_RELEASE_ATTEMPT_PREFIX } },
                {
                  quarantine_attempt_id: {
                    startsWith: CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
                  },
                },
              ],
            },
            {
              OR: [
                { quarantine_lease_renewed_at: null },
                { quarantine_lease_renewed_at: { lte: staleBefore } },
              ],
            },
          ],
        },
        orderBy: { updated_at: 'asc' },
      })) as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findExpiredCaseRoleReleases');
    }
  }

  async findExpiredQuarantineAttempts(staleBefore: Date): Promise<VerificationEvent[]> {
    try {
      return (await this.prisma.verification_events.findMany({
        where: {
          status: VerificationStatus.PENDING,
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          containment_status: CaseContainmentStatus.IN_PROGRESS,
          quarantine_attempt_id: { not: null },
          OR: [
            { quarantine_lease_renewed_at: null },
            { quarantine_lease_renewed_at: { lte: staleBefore } },
          ],
          NOT: [
            { quarantine_attempt_id: { startsWith: CASE_ROLE_RELEASE_ATTEMPT_PREFIX } },
            {
              quarantine_attempt_id: {
                startsWith: CASE_ROLE_RELEASE_RECONCILIATION_ATTEMPT_PREFIX,
              },
            },
          ],
        },
        orderBy: { updated_at: 'asc' },
      })) as VerificationEvent[];
    } catch (error) {
      this.handleError(error, 'findExpiredQuarantineAttempts');
    }
  }

  async markParkedContainmentIncomplete(
    id: string,
    metadata: VerificationEvent['metadata']
  ): Promise<VerificationEvent | null> {
    try {
      const updated = await this.prisma.verification_events.updateMany({
        where: {
          id,
          status: VerificationStatus.PENDING,
          case_kind: CaseKind.COMPROMISED_ACCOUNT,
          attention_state: CaseAttentionState.PARKED,
          containment_status: CaseContainmentStatus.CONTAINED,
          quarantine_attempt_id: null,
        },
        data: {
          attention_state: CaseAttentionState.REVIEW_REQUIRED,
          containment_status: CaseContainmentStatus.INCOMPLETE,
          parked_at: null,
          parked_by: null,
          metadata: metadata as Prisma.InputJsonValue,
          updated_at: new Date(),
        },
      });
      if (updated.count !== 1) {
        return null;
      }
      return (await this.prisma.verification_events.findUnique({
        where: { id },
      })) as VerificationEvent | null;
    } catch (error) {
      this.handleError(error, 'markParkedContainmentIncomplete');
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
    options: {
      touchUpdatedAt?: boolean;
      allowQuarantineOverride?: boolean;
      preservePendingCaseState?: boolean;
      expectedQuarantineAttemptId?: string;
    } = {}
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
        quarantine_attempt_id: data.quarantine_attempt_id,
        quarantine_lease_renewed_at: data.quarantine_lease_renewed_at,
        quarantine_case_role_id: data.quarantine_case_role_id,
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
          updateData.attention_state = CaseAttentionState.REVIEW_REQUIRED;
          updateData.containment_status = CaseContainmentStatus.NOT_APPLICABLE;
          updateData.quarantine_attempt_id = null;
          updateData.quarantine_lease_renewed_at = null;
          updateData.parked_at = null;
          updateData.parked_by = null;
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- This check is necessary
        } else if (data.status === VerificationStatus.PENDING) {
          // Nullify resolution fields if status is pending
          updateData.resolved_at = null;
          updateData.resolved_by = null;
          if (options.preservePendingCaseState !== true) {
            updateData.case_kind = CaseKind.STANDARD;
            updateData.attention_state = CaseAttentionState.REVIEW_REQUIRED;
            updateData.containment_status = CaseContainmentStatus.NOT_APPLICABLE;
            updateData.quarantine_attempt_id = null;
            updateData.quarantine_lease_renewed_at = null;
            updateData.quarantine_case_role_id = null;
            updateData.parked_at = null;
            updateData.parked_by = null;
          }
        }
      }

      const isResolution =
        data.status === VerificationStatus.VERIFIED ||
        data.status === VerificationStatus.BANNED ||
        data.status === VerificationStatus.KICKED ||
        data.status === VerificationStatus.CLOSED_NO_ACTION;
      if (isResolution && options.expectedQuarantineAttemptId) {
        const updated = await this.prisma.verification_events.updateMany({
          where: {
            id,
            status: VerificationStatus.PENDING,
            containment_status: CaseContainmentStatus.IN_PROGRESS,
            quarantine_attempt_id: options.expectedQuarantineAttemptId,
          },
          data: updateData,
        });
        if (updated.count !== 1) {
          return null;
        }
        return (await this.prisma.verification_events.findUnique({
          where: { id },
        })) as VerificationEvent | null;
      }
      if (isResolution && options.allowQuarantineOverride !== true) {
        const updated = await this.prisma.verification_events.updateMany({
          where: {
            id,
            containment_status: { not: CaseContainmentStatus.IN_PROGRESS },
          },
          data: updateData,
        });
        if (updated.count !== 1) {
          return null;
        }
        return (await this.prisma.verification_events.findUnique({
          where: { id },
        })) as VerificationEvent | null;
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
