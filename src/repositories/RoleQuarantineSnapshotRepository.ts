import { inject, injectable } from 'inversify';
import {
  case_containment_status,
  Prisma,
  PrismaClient,
  role_quarantine_snapshot_purpose,
  role_quarantine_snapshot_status,
  verification_status,
} from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotCreate,
  RoleQuarantineSnapshotStatus,
  RoleQuarantineSnapshotUpdate,
  CaseContainmentStatus,
  VerificationStatus,
} from './types';

export interface IRoleQuarantineSnapshotRepository {
  create(data: RoleQuarantineSnapshotCreate): Promise<RoleQuarantineSnapshot>;
  createForQuarantineAttempt(
    data: RoleQuarantineSnapshotCreate,
    verificationEventId: string,
    attemptId: string
  ): Promise<RoleQuarantineSnapshot | null>;
  findActiveByServerAndUser(
    serverId: string,
    userId: string
  ): Promise<RoleQuarantineSnapshot | null>;
  findActiveCompletedCompromised(limit?: number): Promise<RoleQuarantineSnapshot[]>;
  update(id: string, data: RoleQuarantineSnapshotUpdate): Promise<RoleQuarantineSnapshot | null>;
  updateForQuarantineAttempt(
    id: string,
    data: RoleQuarantineSnapshotUpdate,
    verificationEventId: string,
    attemptId: string
  ): Promise<RoleQuarantineSnapshot | null>;
}

@injectable()
export class RoleQuarantineSnapshotRepository implements IRoleQuarantineSnapshotRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(data: RoleQuarantineSnapshotCreate): Promise<RoleQuarantineSnapshot> {
    try {
      const created = await this.prisma.role_quarantine_snapshots.create({
        data: this.toCreateData(data),
      });

      return created as RoleQuarantineSnapshot;
    } catch (error) {
      this.handleError(error, 'createRoleQuarantineSnapshot');
    }
  }

  public async createForQuarantineAttempt(
    data: RoleQuarantineSnapshotCreate,
    verificationEventId: string,
    attemptId: string
  ): Promise<RoleQuarantineSnapshot | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        if (!(await this.renewQuarantineAttempt(transaction, verificationEventId, attemptId))) {
          return null;
        }
        const created = await transaction.role_quarantine_snapshots.create({
          data: this.toCreateData(data),
        });
        return created as RoleQuarantineSnapshot;
      })) as RoleQuarantineSnapshot | null;
    } catch (error) {
      this.handleError(error, 'createRoleQuarantineSnapshotForAttempt');
    }
  }

  public async findActiveByServerAndUser(
    serverId: string,
    userId: string
  ): Promise<RoleQuarantineSnapshot | null> {
    try {
      const snapshot = await this.prisma.role_quarantine_snapshots.findFirst({
        where: {
          server_id: serverId,
          user_id: userId,
          status: RoleQuarantineSnapshotStatus.ACTIVE as role_quarantine_snapshot_status,
        },
        orderBy: { created_at: 'desc' },
      });

      return snapshot as RoleQuarantineSnapshot | null;
    } catch (error) {
      this.handleError(error, 'findActiveRoleQuarantineSnapshot');
    }
  }

  public async findActiveCompletedCompromised(limit = 100): Promise<RoleQuarantineSnapshot[]> {
    try {
      const snapshots = await this.prisma.role_quarantine_snapshots.findMany({
        where: {
          status: RoleQuarantineSnapshotStatus.ACTIVE as role_quarantine_snapshot_status,
          purpose: 'compromised_account' as role_quarantine_snapshot_purpose,
          verification_events: {
            is: { status: VerificationStatus.VERIFIED as verification_status },
          },
        },
        orderBy: { updated_at: 'asc' },
        take: Math.max(1, Math.min(limit, 500)),
      });
      return snapshots as RoleQuarantineSnapshot[];
    } catch (error) {
      this.handleError(error, 'findActiveCompletedCompromisedRoleQuarantines');
    }
  }

  public async update(
    id: string,
    data: RoleQuarantineSnapshotUpdate
  ): Promise<RoleQuarantineSnapshot | null> {
    try {
      const updated = await this.prisma.role_quarantine_snapshots.update({
        where: { id },
        data: this.toUpdateData(data),
      });

      return updated as RoleQuarantineSnapshot;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'updateRoleQuarantineSnapshot');
    }
  }

  public async updateForQuarantineAttempt(
    id: string,
    data: RoleQuarantineSnapshotUpdate,
    verificationEventId: string,
    attemptId: string
  ): Promise<RoleQuarantineSnapshot | null> {
    try {
      return (await this.prisma.$transaction(async (transaction) => {
        if (!(await this.renewQuarantineAttempt(transaction, verificationEventId, attemptId))) {
          return null;
        }
        const updated = await transaction.role_quarantine_snapshots.update({
          where: { id },
          data: this.toUpdateData(data),
        });
        return updated as RoleQuarantineSnapshot;
      })) as RoleQuarantineSnapshot | null;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'updateRoleQuarantineSnapshotForAttempt');
    }
  }

  private async renewQuarantineAttempt(
    transaction: Prisma.TransactionClient,
    verificationEventId: string,
    attemptId: string
  ): Promise<boolean> {
    const renewed = await transaction.verification_events.updateMany({
      where: {
        id: verificationEventId,
        status: VerificationStatus.PENDING as verification_status,
        containment_status: CaseContainmentStatus.IN_PROGRESS as case_containment_status,
        quarantine_attempt_id: attemptId,
      },
      data: { updated_at: new Date() },
    });
    return renewed.count === 1;
  }

  private toCreateData(
    data: RoleQuarantineSnapshotCreate
  ): Prisma.role_quarantine_snapshotsUncheckedCreateInput {
    return {
      server_id: data.serverId,
      user_id: data.userId,
      verification_event_id: data.verificationEventId ?? null,
      mode: data.mode,
      purpose: data.purpose as role_quarantine_snapshot_purpose | undefined,
      original_role_ids: data.originalRoleIds,
      planned_role_ids: data.plannedRoleIds,
      removed_role_ids: data.removedRoleIds ?? [],
      restored_role_ids: data.restoredRoleIds ?? [],
      skipped_roles: (data.skippedRoles ?? []) as Prisma.InputJsonValue,
      failed_removals: (data.failedRemovals ?? []) as Prisma.InputJsonValue,
      failed_restores: (data.failedRestores ?? []) as Prisma.InputJsonValue,
      metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
    };
  }

  private toUpdateData(
    data: RoleQuarantineSnapshotUpdate
  ): Prisma.role_quarantine_snapshotsUncheckedUpdateInput {
    return {
      verification_event_id: data.verificationEventId,
      status: data.status as role_quarantine_snapshot_status | undefined,
      purpose: data.purpose as role_quarantine_snapshot_purpose | undefined,
      original_role_ids: data.originalRoleIds,
      planned_role_ids: data.plannedRoleIds,
      removed_role_ids: data.removedRoleIds,
      restored_role_ids: data.restoredRoleIds,
      skipped_roles:
        data.skippedRoles === undefined ? undefined : (data.skippedRoles as Prisma.InputJsonValue),
      failed_removals:
        data.failedRemovals === undefined
          ? undefined
          : (data.failedRemovals as Prisma.InputJsonValue),
      failed_restores:
        data.failedRestores === undefined
          ? undefined
          : (data.failedRestores as Prisma.InputJsonValue),
      restored_at: data.restoredAt === undefined ? undefined : data.restoredAt,
      restored_by: data.restoredBy === undefined ? undefined : data.restoredBy,
      metadata: data.metadata === undefined ? undefined : (data.metadata as Prisma.InputJsonValue),
      updated_at: new Date(),
    };
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
