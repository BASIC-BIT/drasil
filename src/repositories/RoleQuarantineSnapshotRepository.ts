import { inject, injectable } from 'inversify';
import { Prisma, PrismaClient, role_quarantine_snapshot_status } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { RepositoryError } from './BaseRepository';
import {
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotCreate,
  RoleQuarantineSnapshotStatus,
  RoleQuarantineSnapshotUpdate,
} from './types';

export interface IRoleQuarantineSnapshotRepository {
  create(data: RoleQuarantineSnapshotCreate): Promise<RoleQuarantineSnapshot>;
  findActiveByServerAndUser(
    serverId: string,
    userId: string
  ): Promise<RoleQuarantineSnapshot | null>;
  update(id: string, data: RoleQuarantineSnapshotUpdate): Promise<RoleQuarantineSnapshot | null>;
}

@injectable()
export class RoleQuarantineSnapshotRepository implements IRoleQuarantineSnapshotRepository {
  public constructor(@inject(TYPES.PrismaClient) private readonly prisma: PrismaClient) {}

  public async create(data: RoleQuarantineSnapshotCreate): Promise<RoleQuarantineSnapshot> {
    try {
      const created = await this.prisma.role_quarantine_snapshots.create({
        data: {
          server_id: data.serverId,
          user_id: data.userId,
          verification_event_id: data.verificationEventId ?? null,
          mode: data.mode,
          original_role_ids: data.originalRoleIds,
          planned_role_ids: data.plannedRoleIds,
          removed_role_ids: data.removedRoleIds ?? [],
          restored_role_ids: data.restoredRoleIds ?? [],
          skipped_roles: (data.skippedRoles ?? []) as Prisma.InputJsonValue,
          failed_removals: (data.failedRemovals ?? []) as Prisma.InputJsonValue,
          failed_restores: (data.failedRestores ?? []) as Prisma.InputJsonValue,
          metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      return created as RoleQuarantineSnapshot;
    } catch (error) {
      this.handleError(error, 'createRoleQuarantineSnapshot');
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

  public async update(
    id: string,
    data: RoleQuarantineSnapshotUpdate
  ): Promise<RoleQuarantineSnapshot | null> {
    try {
      const updated = await this.prisma.role_quarantine_snapshots.update({
        where: { id },
        data: {
          status: data.status as role_quarantine_snapshot_status | undefined,
          removed_role_ids: data.removedRoleIds,
          restored_role_ids: data.restoredRoleIds,
          skipped_roles:
            data.skippedRoles === undefined
              ? undefined
              : (data.skippedRoles as Prisma.InputJsonValue),
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
          metadata:
            data.metadata === undefined ? undefined : (data.metadata as Prisma.InputJsonValue),
          updated_at: new Date(),
        },
      });

      return updated as RoleQuarantineSnapshot;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      this.handleError(error, 'updateRoleQuarantineSnapshot');
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
