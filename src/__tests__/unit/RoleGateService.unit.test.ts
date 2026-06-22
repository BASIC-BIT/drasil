import { GuildMember, PermissionFlagsBits, Role, User } from 'discord.js';
import { IConfigService } from '../../config/ConfigService';
import { IAdminActionService } from '../../services/AdminActionService';
import { RoleGateService } from '../../services/RoleGateService';
import { IRoleQuarantineSnapshotRepository } from '../../repositories/RoleQuarantineSnapshotRepository';
import {
  AdminActionType,
  RoleQuarantineSnapshot,
  RoleQuarantineSnapshotStatus,
} from '../../repositories/types';

const createRole = (id: string, name: string, position = 1): Role =>
  ({ id, name, managed: false, position }) as unknown as Role;

const createSnapshot = (roleIds: string[]): RoleQuarantineSnapshot =>
  ({
    id: 'snapshot-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    verification_event_id: 'verification-1',
    status: RoleQuarantineSnapshotStatus.ACTIVE,
    mode: 'automatic',
    original_role_ids: roleIds,
    planned_role_ids: roleIds,
    removed_role_ids: roleIds,
    restored_role_ids: [],
    skipped_roles: [],
    failed_removals: [],
    failed_restores: [],
    created_at: new Date(),
    updated_at: new Date(),
    restored_at: null,
    restored_by: null,
    metadata: {},
  }) as RoleQuarantineSnapshot;

const createMember = (memberRoles: Role[], guildRoles: Role[]): GuildMember => {
  const memberRoleCache = new Map(memberRoles.map((role) => [role.id, role]));
  const guildRoleCache = new Map(guildRoles.map((role) => [role.id, role]));
  const botMember = {
    permissions: {
      has: jest.fn((permission: bigint) => permission === PermissionFlagsBits.ManageRoles),
    },
    roles: {
      highest: {
        comparePositionTo: jest.fn(() => 1),
      },
    },
  };

  return {
    id: 'user-1',
    user: { id: 'user-1', tag: 'user#0001' } as User,
    guild: {
      id: 'guild-1',
      members: {
        me: botMember,
        fetchMe: jest.fn().mockResolvedValue(botMember),
      },
      roles: {
        cache: guildRoleCache,
        fetch: jest.fn(async (roleId: string) => guildRoleCache.get(roleId) ?? null),
      },
    },
    roles: {
      cache: memberRoleCache,
      remove: jest.fn(async (role: Role) => {
        memberRoleCache.delete(role.id);
      }),
      add: jest.fn(async (role: Role) => {
        memberRoleCache.set(role.id, role);
      }),
    },
  } as unknown as GuildMember;
};

const createService = (
  settings: Record<string, unknown>,
  snapshot: RoleQuarantineSnapshot | null = null
): {
  service: RoleGateService;
  adminActionService: jest.Mocked<IAdminActionService>;
} => {
  const configService = {
    getServerConfig: jest.fn().mockResolvedValue({ guild_id: 'guild-1', settings }),
  } as unknown as IConfigService;
  const snapshotRepository = {
    findActiveByServerAndUser: jest.fn().mockResolvedValue(snapshot),
  } as unknown as IRoleQuarantineSnapshotRepository;
  const adminActionService = {
    recordAction: jest.fn().mockResolvedValue({} as any),
    getActionsByAdmin: jest.fn(),
    getActionsForUser: jest.fn(),
    formatActionSummary: jest.fn(),
  } as jest.Mocked<IAdminActionService>;

  return {
    service: new RoleGateService(configService, snapshotRepository, adminActionService),
    adminActionService,
  };
};

describe('RoleGateService (unit)', () => {
  it('removes honeypot role and adds member access role during resolution', async () => {
    const honeypotRole = createRole('111111111111111111', 'Robot');
    const memberAccessRole = createRole('222222222222222222', 'Human');
    const member = createMember([honeypotRole], [honeypotRole, memberAccessRole]);
    const { service, adminActionService } = createService({
      role_gate_enabled: true,
      honeypot_role_id: honeypotRole.id,
      member_access_role_id: memberAccessRole.id,
    });

    const preview = await service.previewResolution(member);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'verify',
      preview
    );

    expect(preview.shouldRemoveHoneypot).toBe(true);
    expect(preview.shouldAddMemberAccess).toBe(true);
    expect(member.roles.remove).toHaveBeenCalledWith(
      honeypotRole,
      expect.stringContaining('Drasil role gate cleanup')
    );
    expect(member.roles.add).toHaveBeenCalledWith(
      memberAccessRole,
      expect.stringContaining('Drasil role gate cleanup')
    );
    expect(result.summaryLines).toEqual(
      expect.arrayContaining([
        `Role gate: removed honeypot role (<@&${honeypotRole.id}>).`,
        `Role gate: added member access role (<@&${memberAccessRole.id}>).`,
      ])
    );
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: AdminActionType.ROLE_GATE_CLEANUP })
    );
  });

  it('keeps quarantined honeypot role removed and adds member access role', async () => {
    const honeypotRole = createRole('111111111111111111', 'Robot');
    const memberAccessRole = createRole('222222222222222222', 'Human');
    const member = createMember([], [honeypotRole, memberAccessRole]);
    const { service } = createService(
      {
        role_gate_enabled: true,
        honeypot_role_id: honeypotRole.id,
        member_access_role_id: memberAccessRole.id,
      },
      createSnapshot([honeypotRole.id])
    );

    const preview = await service.previewResolution(member);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'close_no_action',
      preview
    );

    expect(preview.honeypotRole?.quarantined).toBe(true);
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(member.roles.add).toHaveBeenCalledWith(
      memberAccessRole,
      expect.stringContaining('Drasil role gate cleanup')
    );
    expect(result.results.map((item) => item.status)).toEqual(
      expect.arrayContaining(['kept_removed_by_quarantine', 'added'])
    );
  });

  it('keeps quarantined honeypot role removed when the Discord role was deleted', async () => {
    const honeypotRoleId = '111111111111111111';
    const member = createMember([], []);
    const { service, adminActionService } = createService(
      {
        role_gate_enabled: true,
        honeypot_role_id: honeypotRoleId,
      },
      createSnapshot([honeypotRoleId])
    );

    const preview = await service.previewResolution(member);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'close_no_action',
      preview
    );

    expect(preview.shouldRemoveHoneypot).toBe(true);
    expect(preview.honeypotRole?.exists).toBe(false);
    expect(preview.honeypotRole?.quarantined).toBe(true);
    expect(member.roles.remove).not.toHaveBeenCalled();
    expect(result.applied).toBe(true);
    expect(result.results).toEqual([
      expect.objectContaining({
        operation: 'remove_honeypot',
        status: 'kept_removed_by_quarantine',
        message: `Role gate: honeypot role (<@&${honeypotRoleId}>) was already removed by role quarantine and no longer exists.`,
      }),
    ]);
    expect(adminActionService.recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ action_type: AdminActionType.ROLE_GATE_CLEANUP })
    );
  });

  it('formats confirmation copy with the configured role mentions', async () => {
    const honeypotRole = createRole('111111111111111111', 'Robot');
    const memberAccessRole = createRole('222222222222222222', 'Human');
    const member = createMember([honeypotRole], [honeypotRole, memberAccessRole]);
    const { service } = createService({
      role_gate_enabled: true,
      honeypot_role_id: honeypotRole.id,
      member_access_role_id: memberAccessRole.id,
    });

    const preview = await service.previewResolution(member);

    expect(service.formatResolutionConfirmation(preview)).toContain(
      `remove the honeypot role (<@&${honeypotRole.id}>)`
    );
    expect(service.formatResolutionConfirmation(preview)).toContain(
      `add the member access role (<@&${memberAccessRole.id}>)`
    );
  });

  it('does not show a nothing-to-clean warning when member access will be added', async () => {
    const honeypotRole = createRole('111111111111111111', 'Robot');
    const memberAccessRole = createRole('222222222222222222', 'Human');
    const member = createMember([], [honeypotRole, memberAccessRole]);
    const { service } = createService({
      role_gate_enabled: true,
      honeypot_role_id: honeypotRole.id,
      member_access_role_id: memberAccessRole.id,
    });

    const preview = await service.previewResolution(member);
    const confirmation = service.formatResolutionConfirmation(preview);

    expect(preview.shouldRemoveHoneypot).toBe(false);
    expect(preview.shouldAddMemberAccess).toBe(true);
    expect(confirmation).toContain(`add the member access role (<@&${memberAccessRole.id}>)`);
    expect(confirmation).not.toContain(
      'Neither configured role is currently present or recorded in role quarantine for this member.'
    );
  });

  it('does not record role gate cleanup when member access is already present', async () => {
    const honeypotRole = createRole('111111111111111111', 'Robot');
    const memberAccessRole = createRole('222222222222222222', 'Human');
    const member = createMember([memberAccessRole], [honeypotRole, memberAccessRole]);
    const { service, adminActionService } = createService({
      role_gate_enabled: true,
      honeypot_role_id: honeypotRole.id,
      member_access_role_id: memberAccessRole.id,
    });

    const preview = await service.previewResolution(member);
    const confirmation = service.formatResolutionConfirmation(preview);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'verify',
      preview
    );

    expect(preview.shouldRemoveHoneypot).toBe(false);
    expect(preview.shouldAddMemberAccess).toBe(false);
    expect(confirmation).toBeNull();
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.results).toEqual([]);
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
  });

  it('does not re-add the honeypot role when member access is configured to the same role', async () => {
    const sharedRole = createRole('111111111111111111', 'Human Check');
    const member = createMember([sharedRole], [sharedRole]);
    const { service } = createService({
      role_gate_enabled: true,
      honeypot_role_id: sharedRole.id,
      member_access_role_id: sharedRole.id,
    });

    const preview = await service.previewResolution(member);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'verify',
      preview
    );

    expect(preview.shouldRemoveHoneypot).toBe(true);
    expect(preview.shouldAddMemberAccess).toBe(false);
    expect(preview.warnings).toContain(
      'Configured honeypot role and member access role are the same role; member access cleanup will be skipped.'
    );
    expect(member.roles.remove).toHaveBeenCalledWith(
      sharedRole,
      expect.stringContaining('Drasil role gate cleanup')
    );
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(result.results.map((item) => item.operation)).toEqual(['remove_honeypot']);
  });

  it('does not offer member access cleanup when the configured role is missing', async () => {
    const missingRoleId = '222222222222222222';
    const member = createMember([], []);
    const { service, adminActionService } = createService({
      role_gate_enabled: true,
      member_access_role_id: missingRoleId,
    });

    const preview = await service.previewResolution(member);
    const confirmation = service.formatResolutionConfirmation(preview);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'verify',
      preview
    );

    expect(preview.shouldAddMemberAccess).toBe(false);
    expect(confirmation).not.toContain('this will add the member access role');
    expect(confirmation).toContain(
      `Configured member access role ${missingRoleId} no longer exists.`
    );
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(result.applied).toBe(false);
    expect(result.results).toEqual([]);
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
  });

  it('does not record role gate cleanup when preview only has warnings', async () => {
    const sharedRole = createRole('111111111111111111', 'Human Check');
    const member = createMember([], [sharedRole]);
    const { service, adminActionService } = createService({
      role_gate_enabled: true,
      honeypot_role_id: sharedRole.id,
      member_access_role_id: sharedRole.id,
    });

    const preview = await service.previewResolution(member);
    const result = await service.applyResolution(
      member,
      { id: 'mod-1' } as User,
      'close_no_action',
      preview
    );

    expect(preview.shouldRemoveHoneypot).toBe(false);
    expect(preview.shouldAddMemberAccess).toBe(false);
    expect(preview.warnings).toContain(
      'Configured honeypot role and member access role are the same role; member access cleanup will be skipped.'
    );
    expect(result.applied).toBe(false);
    expect(result.results).toEqual([]);
    expect(adminActionService.recordAction).not.toHaveBeenCalled();
  });
});
