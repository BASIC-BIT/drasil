import { GuildMember, PermissionFlagsBits, Role, User } from 'discord.js';
import { RoleQuarantineService } from '../../services/RoleQuarantineService';
import { InMemoryRoleQuarantineSnapshotRepository } from '../fakes/inMemoryRepositories';
import { IConfigService } from '../../config/ConfigService';
import {
  RoleQuarantineSnapshotStatus,
  VerificationEvent,
  VerificationStatus,
} from '../../repositories/types';

interface FakeRoleOptions {
  id: string;
  name?: string;
  managed?: boolean;
  botId?: string;
  position?: number;
  permissions?: readonly bigint[];
}

const createRole = (options: FakeRoleOptions): Role => {
  const permissionSet = new Set(options.permissions ?? []);
  return {
    id: options.id,
    name: options.name ?? options.id,
    managed: options.managed ?? false,
    position: options.position ?? 1,
    tags: options.botId ? { botId: options.botId } : {},
    permissions: {
      has: jest.fn((permission: bigint) => permissionSet.has(permission)),
    },
  } as unknown as Role;
};

const createVerificationEvent = (): VerificationEvent =>
  ({
    id: 'verification-1',
    server_id: 'guild-1',
    user_id: 'user-1',
    detection_event_id: 'detection-1',
    thread_id: null,
    private_evidence_thread_id: null,
    notification_channel_id: null,
    notification_message_id: null,
    status: VerificationStatus.PENDING,
    created_at: new Date(),
    updated_at: new Date(),
    resolved_at: null,
    resolved_by: null,
    notes: null,
    metadata: {},
  }) as VerificationEvent;

const createConfigService = (
  settings: Record<string, unknown>,
  caseRoleId = 'case-role'
): IConfigService =>
  ({
    getServerConfig: jest.fn().mockResolvedValue({
      guild_id: 'guild-1',
      case_role_id: caseRoleId,
      settings,
    }),
  }) as unknown as IConfigService;

const createMember = (
  memberRoles: readonly Role[],
  guildRoles: readonly Role[] = memberRoles
): GuildMember => {
  const memberRoleCache = new Map(memberRoles.map((role) => [role.id, role]));
  const guildRoleCache = new Map(guildRoles.map((role) => [role.id, role]));
  const botMember = {
    roles: {
      highest: {
        comparePositionTo: jest.fn(
          (role: Role) => 100 - (role as Role & { position: number }).position
        ),
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

describe('RoleQuarantineService (unit)', () => {
  it('removes all removable non-exempt roles and snapshots skipped roles', async () => {
    const safeRole = createRole({ id: 'safe-role', name: 'Community' });
    const managedRole = createRole({ id: 'managed-role', managed: true });
    const botRole = createRole({ id: 'bot-role', botId: 'bot-1' });
    const privilegedRole = createRole({
      id: 'privileged-role',
      permissions: [PermissionFlagsBits.ManageGuild],
    });
    const exemptRole = createRole({ id: '100000000000000005' });
    const highRole = createRole({ id: 'high-role', position: 100 });
    const caseRole = createRole({ id: 'case-role' });
    const member = createMember([
      safeRole,
      managedRole,
      botRole,
      privilegedRole,
      exemptRole,
      highRole,
      caseRole,
    ]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'on',
        role_quarantine_exempt_role_ids: ['100000000000000005'],
      }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.status).toBe('quarantined');
    expect(result.plannedRoleIds).toEqual(['safe-role']);
    expect(result.removedRoleIds).toEqual(['safe-role']);
    expect(result.originalRoleIds).not.toContain('case-role');
    expect(member.roles.remove).toHaveBeenCalledWith(
      safeRole,
      'Drasil role quarantine for case verification-1'
    );
    expect(member.roles.cache.has('safe-role')).toBe(false);
    expect(result.skippedRoles.map((role) => role.role_id)).toEqual(
      expect.arrayContaining([
        'managed-role',
        'bot-role',
        'privileged-role',
        '100000000000000005',
        'high-role',
      ])
    );
    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.removed_role_ids).toEqual(['safe-role']);
  });

  it('records planned restore role ids before Discord removals are finalized', async () => {
    const safeRole = createRole({ id: 'safe-role' });
    const member = createMember([safeRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );
    const updateSnapshot = jest
      .spyOn(snapshots, 'update')
      .mockRejectedValueOnce(new Error('Database unavailable'));

    try {
      await expect(service.quarantineMember(member, createVerificationEvent())).rejects.toThrow(
        'Database unavailable'
      );
      const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
      expect(snapshot?.removed_role_ids).toEqual(['safe-role']);
      expect(member.roles.cache.has('safe-role')).toBe(false);
    } finally {
      updateSnapshot.mockRestore();
    }
  });

  it('records only successfully removed role ids after failed removals are known', async () => {
    const safeRole = createRole({ id: 'safe-role' });
    const failedRole = createRole({ id: 'failed-role' });
    const member = createMember([safeRole, failedRole]);
    (member.roles.remove as jest.Mock).mockImplementation(async (role: Role) => {
      if (role.id === failedRole.id) {
        throw new Error('Missing permissions');
      }
      member.roles.cache.delete(role.id);
    });
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.plannedRoleIds).toEqual(['safe-role', 'failed-role']);
    expect(result.removedRoleIds).toEqual(['safe-role']);
    expect(result.failedRemovals).toEqual([
      expect.objectContaining({ role_id: 'failed-role', reason: 'Missing permissions' }),
    ]);
    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.removed_role_ids).toEqual(['safe-role']);
  });

  it('preserves legacy audit-only mode without removing roles', async () => {
    const safeRole = createRole({ id: 'safe-role' });
    const member = createMember([safeRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'audit_only' }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.status).toBe('audit_only');
    expect(result.plannedRoleIds).toEqual(['safe-role']);
    expect(result.removedRoleIds).toEqual([]);
    expect(member.roles.remove).not.toHaveBeenCalled();
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toBeNull();
  });

  it('does not remove roles again when an active snapshot already exists', async () => {
    const safeRole = createRole({ id: 'safe-role' });
    const member = createMember([safeRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['safe-role'],
      plannedRoleIds: ['safe-role'],
      removedRoleIds: ['safe-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.status).toBe('already_active');
    expect(member.roles.remove).not.toHaveBeenCalled();
  });

  it('removes newly gained removable roles while a case is active', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const gainedRole = createRole({ id: 'gained-role', name: 'Apostle' });
    const oldMember = createMember([caseRole], [caseRole, gainedRole]);
    const newMember = createMember([caseRole, gainedRole], [caseRole, gainedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['original-role'],
      plannedRoleIds: ['original-role'],
      removedRoleIds: ['original-role'],
    });
    const verificationEventRepository = {
      update: jest.fn().mockResolvedValue(createVerificationEvent()),
    };
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots,
      verificationEventRepository as any
    );

    const result = await service.enforceActiveCaseRoleUpdate(
      oldMember,
      newMember,
      createVerificationEvent()
    );

    expect(result.status).toBe('enforced');
    expect(result.snapshotId).toBe(snapshot.id);
    expect(result.addedRoleIds).toEqual(['gained-role']);
    expect(result.plannedRoleIds).toEqual(['gained-role']);
    expect(result.removedRoleIds).toEqual(['gained-role']);
    expect(newMember.roles.remove).toHaveBeenCalledWith(
      gainedRole,
      'Drasil active-case role quarantine for case verification-1'
    );
    expect(newMember.roles.cache.has('gained-role')).toBe(false);
    const updatedSnapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(updatedSnapshot?.removed_role_ids).toEqual(['original-role']);
    expect(updatedSnapshot?.metadata).toEqual(
      expect.objectContaining({
        active_case_role_updates: [
          expect.objectContaining({
            added_role_ids: ['gained-role'],
            removed_role_ids: ['gained-role'],
          }),
        ],
      })
    );
    expect(verificationEventRepository.update).toHaveBeenCalledWith(
      'verification-1',
      {
        metadata: expect.objectContaining({
          active_case_role_updates: [
            expect.objectContaining({
              added_role_ids: ['gained-role'],
              removed_role_ids: ['gained-role'],
            }),
          ],
        }),
      },
      { touchUpdatedAt: false }
    );
  });

  it('skips unsafe newly gained roles during active-case enforcement', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const safeRole = createRole({ id: 'safe-role' });
    const managedRole = createRole({ id: 'managed-role', managed: true });
    const botRole = createRole({ id: 'bot-role', botId: 'bot-1' });
    const privilegedRole = createRole({
      id: 'privileged-role',
      permissions: [PermissionFlagsBits.ModerateMembers],
    });
    const exemptRole = createRole({ id: '100000000000000005' });
    const highRole = createRole({ id: 'high-role', position: 100 });
    const guildRoles = [
      caseRole,
      safeRole,
      managedRole,
      botRole,
      privilegedRole,
      exemptRole,
      highRole,
    ];
    const oldMember = createMember([caseRole], guildRoles);
    const newMember = createMember(guildRoles, guildRoles);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'on',
        role_quarantine_exempt_role_ids: ['100000000000000005'],
      }),
      snapshots
    );

    const result = await service.enforceActiveCaseRoleUpdate(
      oldMember,
      newMember,
      createVerificationEvent()
    );

    expect(result.removedRoleIds).toEqual(['safe-role']);
    expect(result.skippedRoles.map((role) => role.role_id)).toEqual(
      expect.arrayContaining([
        'managed-role',
        'bot-role',
        'privileged-role',
        '100000000000000005',
        'high-role',
      ])
    );
    expect(newMember.roles.cache.has('safe-role')).toBe(false);
    expect(newMember.roles.cache.has('managed-role')).toBe(true);
    expect(newMember.roles.cache.has('100000000000000005')).toBe(true);
  });

  it('audits newly gained roles without removing them in audit-only mode', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const gainedRole = createRole({ id: 'gained-role' });
    const oldMember = createMember([caseRole], [caseRole, gainedRole]);
    const newMember = createMember([caseRole, gainedRole], [caseRole, gainedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'audit_only' }),
      snapshots
    );

    const result = await service.enforceActiveCaseRoleUpdate(
      oldMember,
      newMember,
      createVerificationEvent()
    );

    expect(result.status).toBe('audit_only');
    expect(result.plannedRoleIds).toEqual(['gained-role']);
    expect(result.removedRoleIds).toEqual([]);
    expect(newMember.roles.remove).not.toHaveBeenCalled();
    expect(newMember.roles.cache.has('gained-role')).toBe(true);
  });

  it('restores removed roles additively and skips roles that are no longer safe', async () => {
    const restoredRole = createRole({ id: 'restored-role' });
    const newRole = createRole({ id: 'new-role' });
    const privilegedRole = createRole({
      id: 'privileged-role',
      permissions: [PermissionFlagsBits.Administrator],
    });
    const member = createMember([newRole], [restoredRole, newRole, privilegedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['restored-role', 'privileged-role'],
      plannedRoleIds: ['restored-role', 'privileged-role'],
      removedRoleIds: ['restored-role', 'missing-role', 'privileged-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(result.status).toBe('restored');
    expect(result.restoredRoleIds).toEqual(['restored-role']);
    expect(result.skippedRoles.map((role) => role.role_id)).toEqual(
      expect.arrayContaining(['missing-role', 'privileged-role'])
    );
    expect(member.roles.cache.has('new-role')).toBe(true);
    expect(member.roles.cache.has('restored-role')).toBe(true);
    expect(member.roles.add).toHaveBeenCalledWith(
      restoredRole,
      'Drasil role quarantine restore by moderator-1'
    );
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toBeNull();
    const updated = await snapshots.update(snapshot.id, {});
    expect(updated?.status).toBe(RoleQuarantineSnapshotStatus.RESTORED);
  });

  it('does not restore roles removed after restriction started', async () => {
    const originalRole = createRole({ id: 'original-role' });
    const caseRole = createRole({ id: 'case-role' });
    const gainedRole = createRole({ id: 'gained-role' });
    const oldMember = createMember([caseRole], [caseRole, originalRole, gainedRole]);
    const activeMember = createMember([caseRole, gainedRole], [caseRole, originalRole, gainedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['original-role'],
      plannedRoleIds: ['original-role'],
      removedRoleIds: ['original-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    await service.enforceActiveCaseRoleUpdate(oldMember, activeMember, createVerificationEvent());
    const restoreResult = await service.restoreMemberRoles(activeMember, {
      id: 'moderator-1',
    } as User);

    expect(restoreResult.restoredRoleIds).toEqual(['original-role']);
    expect(activeMember.roles.cache.has('original-role')).toBe(true);
    expect(activeMember.roles.cache.has('gained-role')).toBe(false);
    expect(activeMember.roles.add).toHaveBeenCalledWith(
      originalRole,
      'Drasil role quarantine restore by moderator-1'
    );
  });

  it('keeps a snapshot active when a role restore fails so it can be retried', async () => {
    const restoredRole = createRole({ id: 'restored-role' });
    const member = createMember([], [restoredRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['restored-role'],
      plannedRoleIds: ['restored-role'],
      removedRoleIds: ['restored-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );
    (member.roles.add as jest.Mock).mockRejectedValueOnce(new Error('Discord unavailable'));

    const firstResult = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(firstResult.status).toBe('partially_restored');
    expect(firstResult.failedRestores).toEqual([
      expect.objectContaining({ role_id: 'restored-role', reason: 'Discord unavailable' }),
    ]);
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ id: snapshot.id })
    );

    const secondResult = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(secondResult.status).toBe('restored');
    expect(secondResult.restoredRoleIds).toEqual(['restored-role']);
    expect(member.roles.cache.has('restored-role')).toBe(true);
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toBeNull();
  });

  it('keeps a snapshot active when restore skips a retryable role hierarchy issue', async () => {
    const highRole = createRole({ id: 'high-role', position: 100 });
    const member = createMember([], [highRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['high-role'],
      plannedRoleIds: ['high-role'],
      removedRoleIds: ['high-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(result.status).toBe('partially_restored');
    expect(result.skippedRoles).toEqual([
      expect.objectContaining({ role_id: 'high-role', reason: 'role is at or above Drasil role' }),
    ]);
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({ id: snapshot.id })
    );
  });

  it('does not restore a configured honeypot role during role gate cleanup', async () => {
    const honeypotRole = createRole({ id: '111111111111111111', name: 'Robot' });
    const member = createMember([], [honeypotRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'automatic',
      originalRoleIds: [honeypotRole.id],
      plannedRoleIds: [honeypotRole.id],
      removedRoleIds: [honeypotRole.id],
    });
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'automatic',
        role_gate_enabled: true,
        honeypot_role_id: honeypotRole.id,
      }),
      snapshots
    );

    const result = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(result.status).toBe('restored');
    expect(result.restoredRoleIds).toEqual([]);
    expect(result.skippedRoles).toEqual([
      expect.objectContaining({
        role_id: honeypotRole.id,
        reason: 'policy-managed role gate role',
      }),
    ]);
    expect(member.roles.add).not.toHaveBeenCalled();
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toBeNull();
    const updated = await snapshots.update(snapshot.id, {});
    expect(updated?.status).toBe(RoleQuarantineSnapshotStatus.RESTORED);
  });

  it('abandons an active snapshot without restoring roles', async () => {
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: ['role-1'],
      plannedRoleIds: ['role-1'],
      removedRoleIds: ['role-1'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.abandonActiveSnapshot('guild-1', 'user-1', 'ban', 'moderator-1');

    expect(result).toEqual({ status: 'abandoned', snapshotId: snapshot.id });
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toBeNull();
    const updated = await snapshots.update(snapshot.id, {});
    expect(updated?.status).toBe(RoleQuarantineSnapshotStatus.ABANDONED);
    expect(updated?.metadata).toEqual(
      expect.objectContaining({ abandon_reason: 'ban', abandoned_by: 'moderator-1' })
    );
  });
});
