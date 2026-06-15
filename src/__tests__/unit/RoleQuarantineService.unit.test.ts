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
  restrictedRoleId = 'restricted-role'
): IConfigService =>
  ({
    getServerConfig: jest.fn().mockResolvedValue({
      guild_id: 'guild-1',
      restricted_role_id: restrictedRoleId,
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
    const exemptRole = createRole({ id: '100005' });
    const highRole = createRole({ id: 'high-role', position: 100 });
    const restrictedRole = createRole({ id: 'restricted-role' });
    const member = createMember([
      safeRole,
      managedRole,
      botRole,
      privilegedRole,
      exemptRole,
      highRole,
      restrictedRole,
    ]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'automatic',
        role_quarantine_exempt_role_ids: ['100005'],
      }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.status).toBe('quarantined');
    expect(result.plannedRoleIds).toEqual(['safe-role']);
    expect(result.removedRoleIds).toEqual(['safe-role']);
    expect(result.originalRoleIds).not.toContain('restricted-role');
    expect(member.roles.remove).toHaveBeenCalledWith(
      safeRole,
      'Drasil role quarantine for case verification-1'
    );
    expect(member.roles.cache.has('safe-role')).toBe(false);
    expect(result.skippedRoles.map((role) => role.role_id)).toEqual(
      expect.arrayContaining(['managed-role', 'bot-role', 'privileged-role', '100005', 'high-role'])
    );
    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.removed_role_ids).toEqual(['safe-role']);
  });

  it('audits removable roles without creating a snapshot or removing roles', async () => {
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
      mode: 'automatic',
      originalRoleIds: ['safe-role'],
      plannedRoleIds: ['safe-role'],
      removedRoleIds: ['safe-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'automatic' }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.status).toBe('already_active');
    expect(member.roles.remove).not.toHaveBeenCalled();
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
      mode: 'automatic',
      originalRoleIds: ['restored-role', 'privileged-role'],
      plannedRoleIds: ['restored-role', 'privileged-role'],
      removedRoleIds: ['restored-role', 'missing-role', 'privileged-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'automatic' }),
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

  it('keeps a snapshot active when a role restore fails so it can be retried', async () => {
    const restoredRole = createRole({ id: 'restored-role' });
    const member = createMember([], [restoredRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const snapshot = await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'automatic',
      originalRoleIds: ['restored-role'],
      plannedRoleIds: ['restored-role'],
      removedRoleIds: ['restored-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'automatic' }),
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
});
