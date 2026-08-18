import { GuildMember, PartialGuildMember, Role, User } from 'discord.js';
import { inject, injectable, optional } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IRoleQuarantineSnapshotRepository } from '../repositories/RoleQuarantineSnapshotRepository';
import { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  RoleQuarantineRoleDetail,
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotPurpose,
  ServerSettings,
  RoleQuarantineSnapshotStatus,
  VerificationEvent,
} from '../repositories/types';
import { getManualIntakeSettings } from '../utils/manualIntakeSettings';
import { getRoleGateSettings } from '../utils/roleGateSettings';
import { getRoleQuarantineSettings, RoleQuarantineMode } from '../utils/roleQuarantineSettings';
import { PRIVILEGED_ROLE_PERMISSIONS } from '../utils/privilegedRolePermissions';

export type RoleQuarantineApplyStatus = 'off' | 'audit_only' | 'already_active' | 'quarantined';
export type RoleQuarantineRestoreStatus = 'no_active_snapshot' | 'partially_restored' | 'restored';
export type RoleQuarantineAbandonStatus = 'no_active_snapshot' | 'abandoned';
export type RoleQuarantineActiveCaseUpdateStatus =
  | 'off'
  | 'audit_only'
  | 'no_new_roles'
  | 'enforced';

export interface RoleQuarantineApplyResult {
  readonly status: RoleQuarantineApplyStatus;
  readonly mode: RoleQuarantineMode;
  readonly purpose: RoleQuarantineSnapshotPurpose;
  readonly snapshotId: string | null;
  readonly originalRoleIds: readonly string[];
  readonly plannedRoleIds: readonly string[];
  readonly removedRoleIds: readonly string[];
  readonly skippedRoles: readonly RoleQuarantineRoleDetail[];
  readonly failedRemovals: readonly RoleQuarantineRoleDetail[];
}

export interface RoleQuarantinePreviewResult {
  readonly purpose: RoleQuarantineSnapshotPurpose;
  readonly originalRoleIds: readonly string[];
  readonly plannedRoleIds: readonly string[];
  readonly skippedRoles: readonly RoleQuarantineRoleDetail[];
  readonly privilegedRoleIds: readonly string[];
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

export interface RoleQuarantineActiveCaseUpdateResult {
  readonly status: RoleQuarantineActiveCaseUpdateStatus;
  readonly mode: RoleQuarantineMode;
  readonly snapshotId: string | null;
  readonly addedRoleIds: readonly string[];
  readonly plannedRoleIds: readonly string[];
  readonly removedRoleIds: readonly string[];
  readonly skippedRoles: readonly RoleQuarantineRoleDetail[];
  readonly failedRemovals: readonly RoleQuarantineRoleDetail[];
}

interface ActiveCaseRoleUpdateMetadata {
  readonly at: string;
  readonly verification_event_id: string;
  readonly mode: RoleQuarantineMode;
  readonly added_role_ids: readonly string[];
  readonly planned_role_ids: readonly string[];
  readonly removed_role_ids: readonly string[];
  readonly skipped_roles: readonly RoleQuarantineRoleDetail[];
  readonly failed_removals: readonly RoleQuarantineRoleDetail[];
}

export interface IRoleQuarantineService {
  previewCompromisedAccount(member: GuildMember): Promise<RoleQuarantinePreviewResult>;
  quarantineCompromisedAccount(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator: User
  ): Promise<RoleQuarantineApplyResult>;
  quarantineMember(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<RoleQuarantineApplyResult>;
  enforceActiveCaseRoleUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<RoleQuarantineActiveCaseUpdateResult>;
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

interface QuarantinePolicy {
  readonly purpose: RoleQuarantineSnapshotPurpose;
  readonly exemptRoleIds: ReadonlySet<string>;
  readonly skipPrivilegedRoles: boolean;
}

@injectable()
export class RoleQuarantineService implements IRoleQuarantineService {
  public constructor(
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.RoleQuarantineSnapshotRepository)
    private readonly snapshotRepository: IRoleQuarantineSnapshotRepository,
    @inject(TYPES.VerificationEventRepository)
    @optional()
    private readonly verificationEventRepository?: IVerificationEventRepository
  ) {}

  public async quarantineMember(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator?: User
  ): Promise<RoleQuarantineApplyResult> {
    return this.applyQuarantine(
      member,
      verificationEvent,
      moderator,
      RoleQuarantineSnapshotPurpose.STANDARD_CASE
    );
  }

  public async previewCompromisedAccount(
    member: GuildMember
  ): Promise<RoleQuarantinePreviewResult> {
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const policy = this.buildPolicy(
      RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      serverConfig.settings
    );
    const classifiedRoles = await this.classifyMemberRoles(
      member,
      serverConfig.case_role_id,
      policy
    );
    const removableRoles = classifiedRoles.filter((role) => role.skipReason === undefined);

    return {
      purpose: policy.purpose,
      originalRoleIds: this.getSnapshotRoleIds(member, serverConfig.case_role_id),
      plannedRoleIds: removableRoles.map(({ role }) => role.id),
      skippedRoles: classifiedRoles
        .filter((role) => role.skipReason !== undefined)
        .map(({ role, skipReason }) => this.toRoleDetail(role, skipReason ?? 'skipped')),
      privilegedRoleIds: removableRoles
        .filter(({ role }) => this.hasPrivilegedPermissions(role))
        .map(({ role }) => role.id),
    };
  }

  public async quarantineCompromisedAccount(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator: User
  ): Promise<RoleQuarantineApplyResult> {
    return this.applyQuarantine(
      member,
      verificationEvent,
      moderator,
      RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT
    );
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
    const manualIntakeSettings = getManualIntakeSettings(serverConfig.settings);
    const policyManagedRestoreSkips = new Set<string>();
    if (roleGateSettings.enabled && roleGateSettings.honeypotRoleId) {
      policyManagedRestoreSkips.add(roleGateSettings.honeypotRoleId);
    }
    if (manualIntakeSettings.enabled && manualIntakeSettings.roleId) {
      policyManagedRestoreSkips.add(manualIntakeSettings.roleId);
    }

    const botMember = await this.getBotMember(member);
    const privilegedRoleIdsAtSnapshot = new Set(
      this.readStringArray(this.metadataToRecord(snapshot.metadata).privileged_role_ids_at_snapshot)
    );
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
        policyManagedRestoreSkips,
        privilegedRoleIdsAtSnapshot
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

  public async enforceActiveCaseRoleUpdate(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    verificationEvent: VerificationEvent
  ): Promise<RoleQuarantineActiveCaseUpdateResult> {
    const serverConfig = await this.configService.getServerConfig(newMember.guild.id);
    const settings = getRoleQuarantineSettings(serverConfig.settings);
    const purpose =
      verificationEvent.case_kind === CaseKind.COMPROMISED_ACCOUNT
        ? RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT
        : RoleQuarantineSnapshotPurpose.STANDARD_CASE;
    const mode: RoleQuarantineMode =
      purpose === RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT ? 'on' : settings.mode;
    const policy = this.buildPolicy(purpose, serverConfig.settings);
    const addedRoles = this.getAddedRoles(oldMember, newMember, serverConfig.case_role_id);
    const addedRoleIds = addedRoles.map((role) => role.id);

    if (mode === 'off') {
      return this.activeCaseUpdateResult(mode, 'off', null, addedRoleIds);
    }

    if (addedRoles.length === 0) {
      return this.activeCaseUpdateResult(mode, 'no_new_roles', null, addedRoleIds);
    }

    const activeSnapshot = await this.snapshotRepository.findActiveByServerAndUser(
      newMember.guild.id,
      newMember.id
    );
    const classifiedRoles = await this.classifyRoles(newMember, addedRoles, policy);
    const removableRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason === undefined)
      .map((classifiedRole) => classifiedRole.role);
    const skippedRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason !== undefined)
      .map((classifiedRole) =>
        this.toRoleDetail(classifiedRole.role, classifiedRole.skipReason ?? 'skipped')
      );
    const plannedRoleIds = removableRoles.map((role) => role.id);
    const removedRoleIds: string[] = [];
    const failedRemovals: RoleQuarantineRoleDetail[] = [];

    if (mode === 'on') {
      for (const role of removableRoles) {
        try {
          await newMember.roles.remove(
            role,
            `Drasil active-case role quarantine for case ${verificationEvent.id}`
          );
          removedRoleIds.push(role.id);
        } catch (error) {
          failedRemovals.push(this.toRoleDetail(role, this.formatError(error)));
        }
      }
    }

    await this.recordActiveCaseRoleUpdate(activeSnapshot, verificationEvent, {
      at: new Date().toISOString(),
      verification_event_id: verificationEvent.id,
      mode,
      added_role_ids: addedRoleIds,
      planned_role_ids: plannedRoleIds,
      removed_role_ids: removedRoleIds,
      skipped_roles: skippedRoles,
      failed_removals: failedRemovals,
    });

    if (
      purpose === RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT &&
      (skippedRoles.length > 0 || failedRemovals.length > 0) &&
      this.verificationEventRepository
    ) {
      await this.verificationEventRepository.update(verificationEvent.id, {
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
      });
    }

    return this.activeCaseUpdateResult(
      mode,
      mode === 'audit_only' ? 'audit_only' : 'enforced',
      activeSnapshot?.id ?? null,
      addedRoleIds,
      plannedRoleIds,
      removedRoleIds,
      skippedRoles,
      failedRemovals
    );
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

  private async applyQuarantine(
    member: GuildMember,
    verificationEvent: VerificationEvent,
    moderator: User | undefined,
    purpose: RoleQuarantineSnapshotPurpose
  ): Promise<RoleQuarantineApplyResult> {
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const settings = getRoleQuarantineSettings(serverConfig.settings);
    const mode: RoleQuarantineMode =
      purpose === RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT ? 'on' : settings.mode;
    const currentRoleIds = this.getSnapshotRoleIds(member, serverConfig.case_role_id);
    const activeSnapshot = await this.snapshotRepository.findActiveByServerAndUser(
      member.guild.id,
      member.id
    );

    if (activeSnapshot && purpose === RoleQuarantineSnapshotPurpose.STANDARD_CASE) {
      return this.resultFromActiveSnapshot(activeSnapshot, mode, currentRoleIds);
    }

    if (mode === 'off') {
      return this.emptyApplyResult('off', mode, purpose, currentRoleIds);
    }

    const policy = this.buildPolicy(purpose, serverConfig.settings);
    const classifiedRoles = await this.classifyMemberRoles(
      member,
      serverConfig.case_role_id,
      policy
    );
    const removableRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason === undefined)
      .map((classifiedRole) => classifiedRole.role);
    const skippedRoles = classifiedRoles
      .filter((classifiedRole) => classifiedRole.skipReason !== undefined)
      .map((classifiedRole) =>
        this.toRoleDetail(classifiedRole.role, classifiedRole.skipReason ?? 'skipped')
      );
    const newlyPlannedRoleIds = removableRoles.map((role) => role.id);
    const originalRoleIds = this.uniqueStrings([
      ...(activeSnapshot?.original_role_ids ?? []),
      ...currentRoleIds,
    ]);
    const plannedRoleIds = this.uniqueStrings([
      ...(activeSnapshot?.planned_role_ids ?? []),
      ...newlyPlannedRoleIds,
    ]);

    if (mode === 'audit_only') {
      return {
        status: 'audit_only',
        mode,
        purpose,
        snapshotId: null,
        originalRoleIds,
        plannedRoleIds,
        removedRoleIds: [],
        skippedRoles,
        failedRemovals: [],
      };
    }

    const privilegedRoleIds = this.uniqueStrings([
      ...this.readStringArray(
        this.metadataToRecord(activeSnapshot?.metadata).privileged_role_ids_at_snapshot
      ),
      ...removableRoles
        .filter((role) => this.hasPrivilegedPermissions(role))
        .map((role) => role.id),
    ]);
    const snapshotMetadata = {
      ...this.metadataToRecord(activeSnapshot?.metadata),
      created_by:
        this.metadataToRecord(activeSnapshot?.metadata).created_by ?? moderator?.id ?? null,
      upgraded_by:
        activeSnapshot && purpose === RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT
          ? (moderator?.id ?? null)
          : undefined,
      privileged_role_ids_at_snapshot: privilegedRoleIds,
    } as unknown as Prisma.JsonValue;
    const previouslyRemovedRoleIds = activeSnapshot?.removed_role_ids ?? [];
    const recoveryRoleIds = this.uniqueStrings([
      ...previouslyRemovedRoleIds,
      ...newlyPlannedRoleIds,
    ]);
    const snapshot = activeSnapshot
      ? await this.snapshotRepository.update(activeSnapshot.id, {
          purpose,
          originalRoleIds,
          plannedRoleIds,
          removedRoleIds: recoveryRoleIds,
          skippedRoles: skippedRoles as unknown as Prisma.JsonValue,
          metadata: snapshotMetadata,
        })
      : await this.snapshotRepository.create({
          serverId: member.guild.id,
          userId: member.id,
          verificationEventId: verificationEvent.id,
          mode,
          purpose,
          originalRoleIds,
          plannedRoleIds,
          removedRoleIds: recoveryRoleIds,
          skippedRoles: skippedRoles as unknown as Prisma.JsonValue,
          metadata: snapshotMetadata,
        });

    if (!snapshot) {
      throw new Error(
        `Failed to persist role quarantine snapshot for case ${verificationEvent.id}`
      );
    }

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

    const allRemovedRoleIds = this.uniqueStrings([...previouslyRemovedRoleIds, ...removedRoleIds]);
    const allFailedRemovals = failedRemovals;
    const updatedSnapshot = await this.snapshotRepository.update(snapshot.id, {
      purpose,
      originalRoleIds,
      plannedRoleIds,
      removedRoleIds: allRemovedRoleIds,
      failedRemovals: allFailedRemovals as unknown as Prisma.JsonValue,
      metadata: snapshotMetadata,
    });

    return {
      status: 'quarantined',
      mode,
      purpose,
      snapshotId: updatedSnapshot?.id ?? snapshot.id,
      originalRoleIds,
      plannedRoleIds,
      removedRoleIds: allRemovedRoleIds,
      skippedRoles,
      failedRemovals: allFailedRemovals,
    };
  }

  private buildPolicy(
    purpose: RoleQuarantineSnapshotPurpose,
    settings: ServerSettings
  ): QuarantinePolicy {
    if (purpose === RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT) {
      return { purpose, exemptRoleIds: new Set(), skipPrivilegedRoles: false };
    }

    const quarantineSettings = getRoleQuarantineSettings(settings);
    const manualIntakeSettings = getManualIntakeSettings(settings);
    const exemptRoleIds = new Set(quarantineSettings.exemptRoleIds);
    if (manualIntakeSettings.enabled && manualIntakeSettings.roleId) {
      exemptRoleIds.add(manualIntakeSettings.roleId);
    }
    return { purpose, exemptRoleIds, skipPrivilegedRoles: true };
  }

  private async classifyMemberRoles(
    member: GuildMember,
    caseRoleId: string | null,
    policy: QuarantinePolicy
  ): Promise<ClassifiedRole[]> {
    return this.classifyRoles(member, this.getMemberRoles(member, caseRoleId), policy);
  }

  private async classifyRoles(
    member: GuildMember,
    roles: readonly Role[],
    policy: QuarantinePolicy
  ): Promise<ClassifiedRole[]> {
    const botMember = await this.getBotMember(member);
    return roles.map((role) => ({
      role,
      skipReason: this.getQuarantineSkipReason(member, role, botMember, policy),
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

  private getAddedRoles(
    oldMember: GuildMember | PartialGuildMember,
    newMember: GuildMember,
    caseRoleId: string | null
  ): Role[] {
    return [...newMember.roles.cache.values()].filter(
      (role) =>
        role.id !== newMember.guild.id &&
        role.id !== caseRoleId &&
        !oldMember.roles.cache.has(role.id)
    );
  }

  private getQuarantineSkipReason(
    member: GuildMember,
    role: Role,
    botMember: GuildMember | null,
    policy: QuarantinePolicy
  ): string | undefined {
    if (policy.exemptRoleIds.has(role.id)) {
      return 'configured exempt role';
    }
    if (this.isBotRole(role)) {
      return 'bot-managed role';
    }
    if (role.managed) {
      return 'managed role';
    }
    if (policy.skipPrivilegedRoles && this.hasPrivilegedPermissions(role)) {
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
    policyManagedRestoreSkips: ReadonlySet<string>,
    privilegedRoleIdsAtSnapshot: ReadonlySet<string>
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
    if (this.hasPrivilegedPermissions(role) && !privilegedRoleIdsAtSnapshot.has(role.id)) {
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
      purpose: snapshot.purpose ?? RoleQuarantineSnapshotPurpose.STANDARD_CASE,
      snapshotId: snapshot.id,
      originalRoleIds,
      plannedRoleIds: snapshot.planned_role_ids,
      removedRoleIds: snapshot.removed_role_ids,
      skippedRoles: this.readRoleDetails(snapshot.skipped_roles),
      failedRemovals: this.readRoleDetails(snapshot.failed_removals),
    };
  }

  private emptyApplyResult(
    status: 'off',
    mode: RoleQuarantineMode,
    purpose: RoleQuarantineSnapshotPurpose,
    originalRoleIds: readonly string[]
  ): RoleQuarantineApplyResult {
    return {
      status,
      mode,
      purpose,
      snapshotId: null,
      originalRoleIds,
      plannedRoleIds: [],
      removedRoleIds: [],
      skippedRoles: [],
      failedRemovals: [],
    };
  }

  private activeCaseUpdateResult(
    mode: RoleQuarantineMode,
    status: RoleQuarantineActiveCaseUpdateStatus,
    snapshotId: string | null,
    addedRoleIds: readonly string[],
    plannedRoleIds: readonly string[] = [],
    removedRoleIds: readonly string[] = [],
    skippedRoles: readonly RoleQuarantineRoleDetail[] = [],
    failedRemovals: readonly RoleQuarantineRoleDetail[] = []
  ): RoleQuarantineActiveCaseUpdateResult {
    return {
      status,
      mode,
      snapshotId,
      addedRoleIds,
      plannedRoleIds,
      removedRoleIds,
      skippedRoles,
      failedRemovals,
    };
  }

  private async recordActiveCaseRoleUpdate(
    snapshot: RoleQuarantineSnapshot | null,
    verificationEvent: VerificationEvent,
    entry: ActiveCaseRoleUpdateMetadata
  ): Promise<void> {
    const activeCaseUpdatesKey = 'active_case_role_updates';

    if (snapshot) {
      const snapshotMetadata = this.appendMetadataEntry(
        snapshot.metadata,
        activeCaseUpdatesKey,
        entry
      );
      try {
        await this.snapshotRepository.update(snapshot.id, {
          metadata: snapshotMetadata as unknown as Prisma.JsonValue,
        });
      } catch (error) {
        console.warn(`Failed to record active-case role update on snapshot ${snapshot.id}:`, error);
      }
    }

    if (!this.verificationEventRepository) {
      return;
    }

    const verificationMetadata = this.appendMetadataEntry(
      verificationEvent.metadata,
      activeCaseUpdatesKey,
      entry
    );
    try {
      await this.verificationEventRepository.update(
        verificationEvent.id,
        {
          metadata: verificationMetadata as VerificationEvent['metadata'],
        },
        { touchUpdatedAt: false }
      );
    } catch (error) {
      console.warn(
        `Failed to record active-case role update on verification event ${verificationEvent.id}:`,
        error
      );
    }
  }

  private appendMetadataEntry(
    metadata: unknown,
    key: string,
    entry: ActiveCaseRoleUpdateMetadata
  ): Record<string, unknown> {
    const record = this.metadataToRecord(metadata);
    const existing = record[key];
    const entries = Array.isArray(existing) ? existing : [];
    return {
      ...record,
      [key]: [...entries, entry],
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

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private uniqueStrings(values: readonly string[]): string[] {
    return [...new Set(values)];
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
