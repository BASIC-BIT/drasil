import { inject, injectable } from 'inversify';
import {
  moderation_queue_item_type,
  Prisma,
  PrismaClient,
  role_quarantine_snapshot_status,
  verification_status,
} from '../db/prisma';
import { TYPES } from '../di/symbols';
import {
  AdminAction,
  ModerationOutcome,
  ModerationQueueItem,
  ModerationQueueItemType,
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotStatus,
  ServerMember,
  VerificationEvent,
  VerificationStatus,
} from './types';
import { RepositoryError } from './BaseRepository';

export interface IntegrityAuditVerificationEvent extends VerificationEvent {
  readonly admin_actions: AdminAction[];
  readonly moderation_outcomes: ModerationOutcome[];
}

export interface IntegrityAuditModerationQueueItem extends ModerationQueueItem {
  readonly verification_event_status: VerificationStatus | null;
}

export interface IntegrityAuditCandidateQuery {
  readonly serverId: string;
  readonly since: Date;
  readonly limit: number;
  readonly userId?: string;
}

export interface IntegrityAuditCandidates {
  readonly pendingVerificationEvents: IntegrityAuditVerificationEvent[];
  readonly recentResolvedVerificationEvents: IntegrityAuditVerificationEvent[];
  readonly caseRoleMembers: ServerMember[];
  readonly activeRoleQuarantineSnapshots: RoleQuarantineSnapshot[];
  readonly moderationQueueItems: IntegrityAuditModerationQueueItem[];
}

export interface IIntegrityAuditRepository {
  listCandidates(query: IntegrityAuditCandidateQuery): Promise<IntegrityAuditCandidates>;
}

type ModerationQueueItemWithVerification = ModerationQueueItem & {
  verification_events?: { status: VerificationStatus } | null;
};

@injectable()
export class IntegrityAuditRepository implements IIntegrityAuditRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async listCandidates(
    query: IntegrityAuditCandidateQuery
  ): Promise<IntegrityAuditCandidates> {
    try {
      const userFilter = query.userId ? { user_id: query.userId } : {};
      const verificationWhere: Prisma.verification_eventsWhereInput = {
        server_id: query.serverId,
        ...userFilter,
      };

      const [
        pendingVerificationEvents,
        recentResolvedVerificationEvents,
        caseRoleMembers,
        activeRoleQuarantineSnapshots,
        moderationQueueItems,
      ] = await Promise.all([
        this.prisma.verification_events.findMany({
          where: {
            ...verificationWhere,
            status: VerificationStatus.PENDING as verification_status,
          },
          include: { admin_actions: true, moderation_outcomes: true },
          orderBy: [{ updated_at: 'asc' }, { created_at: 'asc' }],
          take: query.limit,
        }),
        this.prisma.verification_events.findMany({
          where: {
            ...verificationWhere,
            status: {
              in: [
                VerificationStatus.VERIFIED,
                VerificationStatus.BANNED,
                VerificationStatus.KICKED,
                VerificationStatus.CLOSED_NO_ACTION,
              ] as verification_status[],
            },
            OR: [
              { resolved_at: { gte: query.since } },
              { updated_at: { gte: query.since } },
              { created_at: { gte: query.since } },
            ],
          },
          include: { admin_actions: true, moderation_outcomes: true },
          orderBy: [{ resolved_at: 'desc' }, { updated_at: 'desc' }],
          take: query.limit,
        }),
        this.prisma.server_members.findMany({
          where: {
            server_id: query.serverId,
            case_role_active: true,
            verification_status: { not: VerificationStatus.BANNED as verification_status },
            ...userFilter,
          },
          orderBy: { last_status_change: 'asc' },
          take: query.limit,
        }),
        this.prisma.role_quarantine_snapshots.findMany({
          where: {
            server_id: query.serverId,
            status: RoleQuarantineSnapshotStatus.ACTIVE as role_quarantine_snapshot_status,
            ...userFilter,
          },
          orderBy: { created_at: 'asc' },
          take: query.limit,
        }),
        this.prisma.moderation_queue_items.findMany({
          where: {
            server_id: query.serverId,
            ...(query.userId ? { user_id: query.userId } : {}),
            item_type: {
              in: [
                ModerationQueueItemType.CASE_MIRROR,
                ModerationQueueItemType.OBSERVED_ALERT_MIRROR,
                ModerationQueueItemType.SUPPORT_THREAD_ATTENTION,
                ModerationQueueItemType.REPORT_THREAD_ATTENTION,
              ] as moderation_queue_item_type[],
            },
          },
          include: { verification_events: { select: { status: true } } },
          orderBy: [{ updated_at: 'asc' }, { created_at: 'asc' }],
          take: query.limit,
        }),
      ]);

      return {
        pendingVerificationEvents: pendingVerificationEvents as IntegrityAuditVerificationEvent[],
        recentResolvedVerificationEvents:
          recentResolvedVerificationEvents as IntegrityAuditVerificationEvent[],
        caseRoleMembers: caseRoleMembers as ServerMember[],
        activeRoleQuarantineSnapshots: activeRoleQuarantineSnapshots as RoleQuarantineSnapshot[],
        moderationQueueItems: (moderationQueueItems as ModerationQueueItemWithVerification[]).map(
          (item) => ({
            ...item,
            verification_event_status: item.verification_events?.status ?? null,
          })
        ),
      };
    } catch (error) {
      this.handleError(error, 'listIntegrityAuditCandidates');
    }
  }

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
}
