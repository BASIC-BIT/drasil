import { GuildMember, PermissionFlagsBits, Role, User } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IRoleQuarantineSnapshotRepository } from '../repositories/RoleQuarantineSnapshotRepository';
import {
  RoleQuarantineRoleDetail,
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotStatus,
  VerificationEvent,
} from '../repositories/types';
import { getRoleGateSettings } from '../utils/roleGateSettings';
import { getRoleQuarantineSettings, RoleQuarantineMode } from '../utils/roleQuarantineSettings';

export type RoleQuarantineApplyStatus = 'off' | 'audit_only' | 'already_active' | 'quarantined';
export type RoleQuarantineRestoreStatus = 'no_active_snapshot' | 'partially_restored' | 'restored';
export type RoleQuarantineAbandonStatus = 'no_active_snapshot' | 'abandoned';

export interface RoleQuarantineApplyResult {
  readonly status: RoleQuarantineApplyStatus;
  readonly mode: RoleQuarantineMode;
  readonly snapshotId: string | null;
  readonly originalRoleIds: readonly string[];
  readonly plannedRoleIds: readonly string[];
  readonly removedRoleIds: readonly string[];
  readonly skippedRoles: readonly RoleQuarantineRoleDetail[];
  readonly failedRemovals: readonly RoleQuarantineRoleDetail[];
}

export interface RoleQuarantineRestoreResult {
  readonly status: RoleQuarantineRestoreStatus;
  readonly snapshotId: string | null;
  readonly attemptedRoleIds: readonly string[];
  readonly restoredRoleIds: readonly string[];
  readonly skippedRoles: readonly RoleQuarantineRoleDetail[];
  readonly failedRestores: readonly RoleQuarantineRoleDetail[];
}

export interface RoleQuarantineAbandonResult {
  readonly status: RoleQuarantineAbandonStatus;
  readonly snapshotId: string | null;
}

export interface IRoleQuarantineService {
  quarantineMember(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<RoleQuarantineApplyResult>;
  restoreMemberRoles(member: GuildMember, moderator?: User): Promise<RoleQuarantineRestoreResult>;
  abandonActiveSnapshot(
    serverId: string,
    userId: string,
    reason: string,
    actorId?: string | null
  ): Promise<RoleQuarantineAbandonResult>;
}

interface ClassifiedRole {
  readonly role: Role;
  readonly skipReason?: string;
}

const PRIVILEGED_ROLE_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ModerateMembers,
] as const;

@injectable()
export class RoleQuarantineService implements IRoleQuarantineService {
  public constructor(
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.RoleQuarantineSnapshotRepository)
    private readonly snapshotRepository: IRoleQuarantineSnapshotRepository
  ) {}

  public async quarantineMember(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<RoleQuarantineApplyResult> {
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const settings = getRoleQuarantineSettings(serverConfig.settings);
    const originalRoleIds = this.getSnapshotRoleIds(member, serverConfig.case_role_id);

    if (settings.mode === 'off') {
      return {
        status: 'off',
        mode: settings.mode,
        snapshotId: null,
        originalRoleIds,
        plannedRoleIds: [],
        removedRoleIds: [],
        skippedRoles: [],
        failedRemovals: [],
      };
    }

    const activeSnapshot = await this.snapshotRepository.findActiveByServerAndUser(
      member.guild.id,
      member.id
    );
    if (activeSnapshot) {
      return this.resultFromActiveSnapshot(activeSnapshot, settings.mode, originalRoleIds);
    }

    const classifiedRoles = await this.classifyMemberRoles(
      member,
      serverConfig.case_role_id,
      new Set(settings.exemptRoleIds)
    );
    const removableRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason === undefined)
      .map((classifiedRole) => classifiedRole.role);
    const skippedRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason !== undefined)
      .map((classifiedRole) =>
        this.toRoleDetail(classifiedRole.role, classifiedRole.skipReason ?? 'skipped')
      );
    const plannedRoleIds = removableRoles.map((role) => role.id);

    if (settings.mode === 'audit_only') {
      return {
        status: 'audit_only',
        mode: settings.mode,
        snapshotId: null,
        originalRoleIds,
        plannedRoleIds,
        removedRoleIds: [],
        skippedRoles,
        failedRemovals: [],
      };
    }

    const snapshot = await this.snapshotRepository.create({
      serverId: member.guild.id,
      userId: member.id,
      verificationEventId: verificationEvent.id,
      mode: settings.mode,
      originalRoleIds,
      plannedRoleIds,
      removedRoleIds: plannedRoleIds,
      skippedRoles: skippedRoles as unknown as Prisma.JsonValue,
      metadata: {
        created_by: moderator?.id ?? null,
      } as unknown as Prisma.JsonValue,
    });

    const removedRoleIds: string[] = [];
    const failedRemovals: RoleQuarantineRoleDetail[] = [];

    for (const role of removableRoles) {
      try {
        await member.roles.remove(role, `Drasil role quarantine for case ${verificationEvent.id}`);
        removedRoleIds.push(role.id);
      } catch (error) {
        failedRemovals.push(this.toRoleDetail(role, this.formatError(error)));
      }
    }

    const updatedSnapshot = await this.snapshotRepository.update(snapshot.id, {
      removedRoleIds,
      failedRemovals: failedRemovals as unknown as Prisma.JsonValue,
    });

    return {
      status: 'quarantined',
      mode: settings.mode,
      snapshotId: updatedSnapshot?.id ?? snapshot.id,
      originalRoleIds,
      plannedRoleIds,
      removedRoleIds,
      skippedRoles,
      failedRemovals,
    };
  }

  public async restoreMemberRoles(
    member: GuildMember,
    moderator?: User
  ): Promise<RoleQuarantineRestoreResult> {
    const snapshot = await this.snapshotRepository.findActiveByServerAndUser(
      member.guild.id,
      member.id
    );
    if (!snapshot) {
      return {
        status: 'no_active_snapshot',
        snapshotId: null,
        attemptedRoleIds: [],
        restoredRoleIds: [],
        skippedRoles: [],
        failedRestores: [],
      };
    }

    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const roleGateSettings = getRoleGateSettings(serverConfig.settings);
    const policyManagedRestoreSkips = new Set<string>();
    if (roleGateSettings.enabled && roleGateSettings.honeypotRoleId) {
      policyManagedRestoreSkips.add(roleGateSettings.honeypotRoleId);
    }

    const botMember = await this.getBotMember(member);
    const attemptedRoleIds = [...snapshot.removed_role_ids];
    const restoredRoleIds: string[] = [];
    const skippedRoles: RoleQuarantineRoleDetail[] = [];
    const failedRestores: RoleQuarantineRoleDetail[] = [];

    for (const roleId of attemptedRoleIds) {
      const role = await this.getGuildRole(member, roleId);
      if (!role) {
        skippedRoles.push({ role_id: roleId, reason: 'role no longer exists' });
        continue;
      }

      const restoreSkipReason = this.getRestoreSkipReason(
        role,
        botMember,
        policyManagedRestoreSkips
      );
      if (restoreSkipReason) {
        skippedRoles.push(this.toRoleDetail(role, restoreSkipReason));
        continue;
      }

      if (member.roles.cache.has(role.id)) {
        restoredRoleIds.push(role.id);
        continue;
      }

      try {
        await member.roles.add(role, this.formatRestoreReason(moderator));
        restoredRoleIds.push(role.id);
      } catch (error) {
        failedRestores.push(this.toRoleDetail(role, this.formatError(error)));
      }
    }

    const retryableSkippedRoles = skippedRoles.filter((role) =>
      this.isRetryableRestoreSkipReason(role.reason)
    );
    const restoreStatus: RoleQuarantineRestoreStatus =
      failedRestores.length > 0 || retryableSkippedRoles.length > 0
        ? 'partially_restored'
        : 'restored';
    const restoreCompleted = restoreStatus === 'restored';

    await this.snapshotRepository.update(snapshot.id, {
      status: restoreCompleted
        ? RoleQuarantineSnapshotStatus.RESTORED
        : RoleQuarantineSnapshotStatus.ACTIVE,
      restoredRoleIds,
      failedRestores: failedRestores as unknown as Prisma.JsonValue,
      metadata: {
        ...this.metadataToRecord(snapshot.metadata),
        restore_skipped_roles: skippedRoles,
        restore_retryable_skipped_roles: retryableSkippedRoles,
      } as unknown as Prisma.JsonValue,
      restoredAt: restoreCompleted ? new Date() : undefined,
      restoredBy: restoreCompleted ? (moderator?.id ?? null) : undefined,
    });

    return {
      status: restoreStatus,
      snapshotId: snapshot.id,
      attemptedRoleIds,
      restoredRoleIds,
      skippedRoles,
      failedRestores,
    };
  }

  public async abandonActiveSnapshot(
    serverId: string,
    userId: string,
    reason: string,
    actorId?: string | null
  ): Promise<RoleQuarantineAbandonResult> {
    const snapshot = await this.snapshotRepository.findActiveByServerAndUser(serverId, userId);
    if (!snapshot) {
      return { status: 'no_active_snapshot', snapshotId: null };
    }

    await this.snapshotRepository.update(snapshot.id, {
      status: RoleQuarantineSnapshotStatus.ABANDONED,
      metadata: {
        ...this.metadataToRecord(snapshot.metadata),
        abandoned_at: new Date().toISOString(),
        abandoned_by: actorId ?? null,
        abandon_reason: reason,
      } as unknown as Prisma.JsonValue,
    });

    return { status: 'abandoned', snapshotId: snapshot.id };
  }

  private async classifyMemberRoles(
    member: GuildMember,
    caseRoleId: string | null,
    exemptRoleIds: ReadonlySet<string>
  ): Promise<ClassifiedRole[]> {
    const botMember = await this.getBotMember(member);
    return this.getMemberRoles(member, caseRoleId).map((role) => ({
      role,
      skipReason: this.getQuarantineSkipReason(member, role, botMember, exemptRoleIds),
    }));
  }

  private getSnapshotRoleIds(member: GuildMember, caseRoleId: string | null): string[] {
    return this.getMemberRoles(member, caseRoleId).map((role) => role.id);
  }

  private getMemberRoles(member: GuildMember, caseRoleId: string | null): Role[] {
    return [...member.roles.cache.values()].filter(
      (role) => role.id !== member.guild.id && role.id !== caseRoleId
    );
  }

  private getQuarantineSkipReason(
    member: GuildMember,
    role: Role,
    botMember: GuildMember | null,
    exemptRoleIds: ReadonlySet<string>
  ): string | undefined {
    if (exemptRoleIds.has(role.id)) {
      return 'configured exempt role';
    }
    if (this.isBotRole(role)) {
      return 'bot-managed role';
    }
    if (role.managed) {
      return 'managed role';
    }
    if (this.hasPrivilegedPermissions(role)) {
      return 'privileged role';
    }
    if (!botMember) {
      return 'Drasil member could not be loaded';
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      return 'role is at or above Drasil role';
    }

    return undefined;
  }

  private getRestoreSkipReason(
    role: Role,
    botMember: GuildMember | null,
    policyManagedRestoreSkips: ReadonlySet<string>
  ): string | undefined {
    if (policyManagedRestoreSkips.has(role.id)) {
      return 'policy-managed role gate role';
    }
    if (this.isBotRole(role)) {
      return 'bot-managed role';
    }
    if (role.managed) {
      return 'managed role';
    }
    if (this.hasPrivilegedPermissions(role)) {
      return 'role became privileged';
    }
    if (!botMember) {
      return 'Drasil member could not be loaded';
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      return 'role is at or above Drasil role';
    }

    return undefined;
  }

  private isRetryableRestoreSkipReason(reason: string): boolean {
    return (
      reason === 'Drasil member could not be loaded' || reason === 'role is at or above Drasil role'
    );
  }

  private formatRestoreReason(moderator?: User): string {
    return moderator
      ? `Drasil role quarantine restore by ${moderator.id}`
      : 'Drasil role quarantine restore rollback';
  }

  private hasPrivilegedPermissions(role: Role): boolean {
    return PRIVILEGED_ROLE_PERMISSIONS.some((permission) => role.permissions.has(permission));
  }

  private isBotRole(role: Role): boolean {
    const tags = role.tags as { botId?: string | null } | null;
    return typeof tags?.botId === 'string';
  }

  private async getBotMember(member: GuildMember): Promise<GuildMember | null> {
    return member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
  }

  private async getGuildRole(member: GuildMember, roleId: string): Promise<Role | null> {
    const cached = member.guild.roles.cache.get(roleId);
    if (cached) {
      return cached;
    }

    return member.guild.roles.fetch(roleId).catch(() => null);
  }

  private toRoleDetail(role: Role, reason: string): RoleQuarantineRoleDetail {
    return {
      role_id: role.id,
      role_name: role.name,
      reason,
    };
  }

  private resultFromActiveSnapshot(
    snapshot: RoleQuarantineSnapshot,
    mode: RoleQuarantineMode,
    originalRoleIds: readonly string[]
  ): RoleQuarantineApplyResult {
    return {
      status: 'already_active',
      mode,
      snapshotId: snapshot.id,
      originalRoleIds,
      plannedRoleIds: snapshot.planned_role_ids,
      removedRoleIds: snapshot.removed_role_ids,
      skippedRoles: this.readRoleDetails(snapshot.skipped_roles),
      failedRemovals: this.readRoleDetails(snapshot.failed_removals),
    };
  }

  private readRoleDetails(value: unknown): RoleQuarantineRoleDetail[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is RoleQuarantineRoleDetail => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }

      const detail = item as Record<string, unknown>;
      return typeof detail.role_id === 'string' && typeof detail.reason === 'string';
    });
  }

  private metadataToRecord(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    return { ...(metadata as Record<string, unknown>) };
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || 'Unknown error');
  }
}
