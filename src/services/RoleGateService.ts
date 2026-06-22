import { GuildMember, PermissionFlagsBits, Role, User } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { Prisma } from '../db/prisma';
import { TYPES } from '../di/symbols';
import { IRoleQuarantineSnapshotRepository } from '../repositories/RoleQuarantineSnapshotRepository';
import { AdminActionType, RoleQuarantineSnapshot } from '../repositories/types';
import { getRoleGateSettings, RoleGateSettings } from '../utils/roleGateSettings';
import { IAdminActionService } from './AdminActionService';

export type RoleGateResolutionAction = 'verify' | 'close_no_action';

export interface RoleGateRolePreview {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly mention: string;
  readonly exists: boolean;
  readonly current: boolean;
  readonly quarantined: boolean;
}

export interface RoleGateResolutionPreview {
  readonly enabled: boolean;
  readonly honeypotRole: RoleGateRolePreview | null;
  readonly memberAccessRole: RoleGateRolePreview | null;
  readonly shouldRemoveHoneypot: boolean;
  readonly shouldAddMemberAccess: boolean;
  readonly warnings: readonly string[];
  readonly activeSnapshotId: string | null;
}

export interface RoleGateRoleResult {
  readonly roleId: string;
  readonly roleName: string | null;
  readonly operation: 'remove_honeypot' | 'add_member_access';
  readonly status:
    | 'removed'
    | 'added'
    | 'already_absent'
    | 'already_present'
    | 'kept_removed_by_quarantine'
    | 'failed';
  readonly message: string;
  readonly error?: string;
}

export interface RoleGateResolutionResult {
  readonly applied: boolean;
  readonly results: readonly RoleGateRoleResult[];
  readonly warnings: readonly string[];
  readonly summaryLines: readonly string[];
}

export interface IRoleGateService {
  previewResolution(member: GuildMember): Promise<RoleGateResolutionPreview>;
  formatResolutionConfirmation(preview: RoleGateResolutionPreview): string | null;
  applyResolution(
    member: GuildMember,
    moderator: User,
    action: RoleGateResolutionAction,
    preview?: RoleGateResolutionPreview
  ): Promise<RoleGateResolutionResult>;
}

@injectable()
export class RoleGateService implements IRoleGateService {
  public constructor(
    @inject(TYPES.ConfigService) private readonly configService: IConfigService,
    @inject(TYPES.RoleQuarantineSnapshotRepository)
    private readonly snapshotRepository: IRoleQuarantineSnapshotRepository,
    @inject(TYPES.AdminActionService) private readonly adminActionService: IAdminActionService
  ) {}

  public async previewResolution(member: GuildMember): Promise<RoleGateResolutionPreview> {
    const serverConfig = await this.configService.getServerConfig(member.guild.id);
    const settings = getRoleGateSettings(serverConfig.settings);
    const snapshot = settings.enabled
      ? await this.snapshotRepository.findActiveByServerAndUser(member.guild.id, member.id)
      : null;

    return await this.buildPreview(member, settings, snapshot);
  }

  public formatResolutionConfirmation(preview: RoleGateResolutionPreview): string | null {
    if (!preview.enabled) {
      return null;
    }

    const lines: string[] = [];
    if (preview.shouldRemoveHoneypot && preview.honeypotRole) {
      const source = preview.honeypotRole.quarantined
        ? 'currently assigned or held in quarantine'
        : 'currently assigned';
      lines.push(
        `Role gate: this will remove the honeypot role (${preview.honeypotRole.mention}) if it is ${source}.`
      );
    }
    if (preview.shouldAddMemberAccess && preview.memberAccessRole) {
      const verb = preview.memberAccessRole.current ? 'keep' : 'add';
      lines.push(
        `Role gate: this will ${verb} the member access role (${preview.memberAccessRole.mention}).`
      );
    }
    lines.push(...preview.warnings.map((warning) => `Role gate warning: ${warning}`));

    return lines.length > 0 ? lines.join('\n') : null;
  }

  public async applyResolution(
    member: GuildMember,
    moderator: User,
    action: RoleGateResolutionAction,
    preview?: RoleGateResolutionPreview
  ): Promise<RoleGateResolutionResult> {
    const effectivePreview = preview ?? (await this.previewResolution(member));
    if (!effectivePreview.enabled) {
      return { applied: false, results: [], warnings: [], summaryLines: [] };
    }

    const results: RoleGateRoleResult[] = [];
    const warnings = [...effectivePreview.warnings];

    if (effectivePreview.shouldRemoveHoneypot && effectivePreview.honeypotRole) {
      results.push(await this.removeHoneypotRole(member, effectivePreview.honeypotRole, moderator));
    }

    if (effectivePreview.shouldAddMemberAccess && effectivePreview.memberAccessRole) {
      results.push(
        await this.addMemberAccessRole(member, effectivePreview.memberAccessRole, moderator)
      );
    }

    const summaryLines = results.map((result) => result.message);
    const applied = results.length > 0 || warnings.length > 0;
    if (applied) {
      await this.recordRoleGateAction(
        member,
        moderator,
        action,
        effectivePreview,
        results,
        warnings
      );
    }

    return { applied, results, warnings, summaryLines };
  }

  private async buildPreview(
    member: GuildMember,
    settings: RoleGateSettings,
    snapshot: RoleQuarantineSnapshot | null
  ): Promise<RoleGateResolutionPreview> {
    if (!settings.enabled) {
      return {
        enabled: false,
        honeypotRole: null,
        memberAccessRole: null,
        shouldRemoveHoneypot: false,
        shouldAddMemberAccess: false,
        warnings: [],
        activeSnapshotId: null,
      };
    }

    const honeypotRole = settings.honeypotRoleId
      ? await this.previewRole(member, settings.honeypotRoleId, snapshot)
      : null;
    const memberAccessRole = settings.memberAccessRoleId
      ? await this.previewRole(member, settings.memberAccessRoleId, snapshot)
      : null;
    const warnings = this.buildPreviewWarnings(honeypotRole, memberAccessRole);

    return {
      enabled: true,
      honeypotRole,
      memberAccessRole,
      shouldRemoveHoneypot: Boolean(
        honeypotRole && (honeypotRole.current || honeypotRole.quarantined)
      ),
      shouldAddMemberAccess: Boolean(
        memberAccessRole && memberAccessRole.roleId !== honeypotRole?.roleId
      ),
      warnings,
      activeSnapshotId: snapshot?.id ?? null,
    };
  }

  private async previewRole(
    member: GuildMember,
    roleId: string,
    snapshot: RoleQuarantineSnapshot | null
  ): Promise<RoleGateRolePreview> {
    const role = await this.getGuildRole(member, roleId);
    return {
      roleId,
      roleName: role?.name ?? null,
      mention: `<@&${roleId}>`,
      exists: Boolean(role),
      current: member.roles.cache.has(roleId),
      quarantined: this.snapshotContainsRole(snapshot, roleId),
    };
  }

  private buildPreviewWarnings(
    honeypotRole: RoleGateRolePreview | null,
    memberAccessRole: RoleGateRolePreview | null
  ): string[] {
    const warnings: string[] = [];
    if (honeypotRole && !honeypotRole.exists) {
      warnings.push(`Configured honeypot role ${honeypotRole.roleId} no longer exists.`);
    }
    if (memberAccessRole && !memberAccessRole.exists) {
      warnings.push(`Configured member access role ${memberAccessRole.roleId} no longer exists.`);
    }
    if (honeypotRole && memberAccessRole && honeypotRole.roleId === memberAccessRole.roleId) {
      warnings.push(
        'Configured honeypot role and member access role are the same role; member access cleanup will be skipped.'
      );
    }
    if (
      honeypotRole &&
      memberAccessRole &&
      !honeypotRole.current &&
      !honeypotRole.quarantined &&
      !memberAccessRole.current &&
      !memberAccessRole.quarantined
    ) {
      warnings.push(
        'Neither configured role is currently present or recorded in role quarantine for this member.'
      );
    }

    return warnings;
  }

  private async removeHoneypotRole(
    member: GuildMember,
    preview: RoleGateRolePreview,
    moderator: User
  ): Promise<RoleGateRoleResult> {
    const role = await this.getGuildRole(member, preview.roleId);
    if (!role) {
      return this.roleResult(preview, 'remove_honeypot', 'failed', 'Honeypot role is missing.');
    }

    const skipReason = await this.getRoleMutationSkipReason(member, role);
    if (skipReason) {
      return this.roleResult(preview, 'remove_honeypot', 'failed', skipReason);
    }

    if (!member.roles.cache.has(role.id)) {
      const status = preview.quarantined ? 'kept_removed_by_quarantine' : 'already_absent';
      const message = preview.quarantined
        ? `Role gate: honeypot role (${preview.mention}) was already removed by role quarantine and was not restored.`
        : `Role gate: honeypot role (${preview.mention}) was already absent.`;
      return this.roleResult(preview, 'remove_honeypot', status, message);
    }

    try {
      await member.roles.remove(role, `Drasil role gate cleanup by ${moderator.id}`);
      return this.roleResult(
        preview,
        'remove_honeypot',
        'removed',
        `Role gate: removed honeypot role (${preview.mention}).`
      );
    } catch (error) {
      return this.roleResult(
        preview,
        'remove_honeypot',
        'failed',
        `Role gate: failed to remove honeypot role (${preview.mention}).`,
        this.formatError(error)
      );
    }
  }

  private async addMemberAccessRole(
    member: GuildMember,
    preview: RoleGateRolePreview,
    moderator: User
  ): Promise<RoleGateRoleResult> {
    const role = await this.getGuildRole(member, preview.roleId);
    if (!role) {
      return this.roleResult(
        preview,
        'add_member_access',
        'failed',
        'Member access role is missing.'
      );
    }

    const skipReason = await this.getRoleMutationSkipReason(member, role);
    if (skipReason) {
      return this.roleResult(preview, 'add_member_access', 'failed', skipReason);
    }

    if (member.roles.cache.has(role.id)) {
      return this.roleResult(
        preview,
        'add_member_access',
        'already_present',
        `Role gate: member access role (${preview.mention}) is already present.`
      );
    }

    try {
      await member.roles.add(role, `Drasil role gate cleanup by ${moderator.id}`);
      return this.roleResult(
        preview,
        'add_member_access',
        'added',
        `Role gate: added member access role (${preview.mention}).`
      );
    } catch (error) {
      return this.roleResult(
        preview,
        'add_member_access',
        'failed',
        `Role gate: failed to add member access role (${preview.mention}).`,
        this.formatError(error)
      );
    }
  }

  private roleResult(
    preview: RoleGateRolePreview,
    operation: RoleGateRoleResult['operation'],
    status: RoleGateRoleResult['status'],
    message: string,
    error?: string
  ): RoleGateRoleResult {
    return {
      roleId: preview.roleId,
      roleName: preview.roleName,
      operation,
      status,
      message,
      ...(error ? { error } : {}),
    };
  }

  private async getRoleMutationSkipReason(member: GuildMember, role: Role): Promise<string | null> {
    if (role.id === member.guild.id) {
      return '@everyone cannot be managed by role gate.';
    }
    if (role.managed) {
      return `Role gate: role (${role.id}) is managed by an integration.`;
    }

    const botMember = await this.getBotMember(member);
    if (!botMember) {
      return 'Role gate: Drasil member could not be loaded for role hierarchy checks.';
    }
    const permissions = (botMember as { permissions?: { has(permission: bigint): boolean } })
      .permissions;
    if (permissions && !permissions.has(PermissionFlagsBits.ManageRoles)) {
      return 'Role gate: Drasil is missing Manage Roles.';
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      return `Role gate: move the Drasil role above (${role.name}).`;
    }

    return null;
  }

  private async recordRoleGateAction(
    member: GuildMember,
    moderator: User,
    action: RoleGateResolutionAction,
    preview: RoleGateResolutionPreview,
    results: readonly RoleGateRoleResult[],
    warnings: readonly string[]
  ): Promise<void> {
    try {
      await this.adminActionService.recordAction({
        server_id: member.guild.id,
        user_id: member.id,
        admin_id: moderator.id,
        verification_event_id: null,
        detection_event_id: null,
        action_type: AdminActionType.ROLE_GATE_CLEANUP,
        previous_status: null,
        new_status: null,
        notes: `Role gate cleanup after ${action}.`,
        metadata: {
          role_gate: {
            resolution_action: action,
            active_snapshot_id: preview.activeSnapshotId,
            honeypot_role_id: preview.honeypotRole?.roleId ?? null,
            honeypot_current: preview.honeypotRole?.current ?? null,
            honeypot_quarantined: preview.honeypotRole?.quarantined ?? null,
            member_access_role_id: preview.memberAccessRole?.roleId ?? null,
            member_access_current: preview.memberAccessRole?.current ?? null,
            member_access_quarantined: preview.memberAccessRole?.quarantined ?? null,
            results,
            warnings,
          },
        } as unknown as Prisma.JsonValue,
      });
    } catch (error) {
      console.warn(`Failed to record role gate cleanup for ${member.id}:`, error);
    }
  }

  private snapshotContainsRole(snapshot: RoleQuarantineSnapshot | null, roleId: string): boolean {
    if (!snapshot) {
      return false;
    }

    return (
      snapshot.original_role_ids.includes(roleId) ||
      snapshot.planned_role_ids.includes(roleId) ||
      snapshot.removed_role_ids.includes(roleId)
    );
  }

  private async getGuildRole(member: GuildMember, roleId: string): Promise<Role | null> {
    const cached = member.guild.roles.cache.get(roleId);
    if (cached) {
      return cached;
    }

    return member.guild.roles.fetch(roleId).catch(() => null);
  }

  private async getBotMember(member: GuildMember): Promise<GuildMember | null> {
    return member.guild.members.me ?? (await member.guild.members.fetchMe().catch(() => null));
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message) {
      return error.message;
    }

    return String(error || 'Unknown error');
  }
}
