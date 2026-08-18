import { GuildMember, PermissionFlagsBits, Role, User } from 'discord.js';
import {
  RoleQuarantineApplyError,
  RoleQuarantineService,
} from '../../services/RoleQuarantineService';
import { InMemoryRoleQuarantineSnapshotRepository } from '../fakes/inMemoryRepositories';
import { IConfigService } from '../../config/ConfigService';
import {
  CaseAttentionState,
  CaseContainmentStatus,
  CaseKind,
  RoleQuarantineSnapshotPurpose,
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

  it('does not quarantine the configured manual intake trigger role', async () => {
    const manualRole = createRole({ id: '100000000000000010', name: 'Manual Intake' });
    const communityRole = createRole({ id: 'community-role', name: 'Community' });
    const member = createMember([manualRole, communityRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'on',
        manual_intake_enabled: true,
        manual_intake_role_id: manualRole.id,
      }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.removedRoleIds).toEqual(['community-role']);
    expect(result.plannedRoleIds).toEqual(['community-role']);
    expect(result.skippedRoles).toEqual(
      expect.arrayContaining([expect.objectContaining({ role_id: manualRole.id })])
    );
    expect(member.roles.cache.has(manualRole.id)).toBe(true);
    expect(member.roles.cache.has(communityRole.id)).toBe(false);
  });

  it('preserves the standard quarantine privilege policy for moderation permissions', async () => {
    const removableRoles = [
      createRole({ id: 'channel-role', permissions: [PermissionFlagsBits.ManageChannels] }),
      createRole({ id: 'kick-role', permissions: [PermissionFlagsBits.KickMembers] }),
      createRole({ id: 'ban-role', permissions: [PermissionFlagsBits.BanMembers] }),
      createRole({ id: 'message-role', permissions: [PermissionFlagsBits.ManageMessages] }),
      createRole({ id: 'thread-role', permissions: [PermissionFlagsBits.ManageThreads] }),
      createRole({ id: 'webhook-role', permissions: [PermissionFlagsBits.ManageWebhooks] }),
      createRole({ id: 'mute-role', permissions: [PermissionFlagsBits.MuteMembers] }),
      createRole({ id: 'deafen-role', permissions: [PermissionFlagsBits.DeafenMembers] }),
      createRole({ id: 'move-role', permissions: [PermissionFlagsBits.MoveMembers] }),
      createRole({ id: 'nickname-role', permissions: [PermissionFlagsBits.ManageNicknames] }),
    ];
    const member = createMember(removableRoles);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots
    );

    const result = await service.quarantineMember(member, createVerificationEvent());

    expect(result.removedRoleIds).toEqual([
      'channel-role',
      'kick-role',
      'ban-role',
      'message-role',
      'thread-role',
      'webhook-role',
      'mute-role',
      'deafen-role',
      'move-role',
      'nickname-role',
    ]);
    expect(result.skippedRoles).toEqual([]);
  });

  it('removes privileged and normally exempt roles for a compromised account', async () => {
    const privilegedRoles = [
      createRole({ id: 'mute-role', permissions: [PermissionFlagsBits.MuteMembers] }),
      createRole({ id: 'deafen-role', permissions: [PermissionFlagsBits.DeafenMembers] }),
      createRole({ id: 'move-role', permissions: [PermissionFlagsBits.MoveMembers] }),
      createRole({ id: 'nickname-role', permissions: [PermissionFlagsBits.ManageNicknames] }),
    ];
    const exemptRole = createRole({ id: '100000000000000005' });
    const manualRole = createRole({ id: '100000000000000010' });
    const member = createMember([...privilegedRoles, exemptRole, manualRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'off',
        role_quarantine_exempt_role_ids: [exemptRole.id],
        manual_intake_enabled: true,
        manual_intake_role_id: manualRole.id,
      }),
      snapshots
    );
    const verificationEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    };

    const result = await service.quarantineCompromisedAccount(
      member,
      verificationEvent,
      { id: 'moderator-1' } as User,
      { attemptId: 'attempt-1', assertOwner: async () => undefined }
    );

    expect(result.purpose).toBe(RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT);
    expect(result.removedRoleIds).toEqual([
      'mute-role',
      'deafen-role',
      'move-role',
      'nickname-role',
      '100000000000000005',
      '100000000000000010',
    ]);
    expect(result.failedRemovals).toEqual([]);
    await expect(snapshots.findActiveByServerAndUser('guild-1', 'user-1')).resolves.toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          privileged_role_ids_at_snapshot: [
            'mute-role',
            'deafen-role',
            'move-role',
            'nickname-role',
          ],
        }),
      })
    );
  });

  it('restores a privileged role that was privileged when account quarantine began', async () => {
    const privilegedRole = createRole({
      id: 'privileged-role',
      permissions: [PermissionFlagsBits.Administrator],
    });
    const member = createMember([], [privilegedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      purpose: RoleQuarantineSnapshotPurpose.COMPROMISED_ACCOUNT,
      originalRoleIds: [privilegedRole.id],
      plannedRoleIds: [privilegedRole.id],
      removedRoleIds: [privilegedRole.id],
      metadata: { privileged_role_ids_at_snapshot: [privilegedRole.id] },
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      snapshots
    );

    const result = await service.restoreMemberRoles(member, { id: 'moderator-1' } as User);

    expect(result.status).toBe('restored');
    expect(result.restoredRoleIds).toEqual([privilegedRole.id]);
    expect(member.roles.cache.has(privilegedRole.id)).toBe(true);
  });

  it('does not restore a manual intake trigger role from an older active quarantine snapshot', async () => {
    const manualRole = createRole({ id: '100000000000000010', name: 'Manual Intake' });
    const communityRole = createRole({ id: 'community-role', name: 'Community' });
    const member = createMember([], [manualRole, communityRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'verification-1',
      mode: 'on',
      originalRoleIds: [manualRole.id, communityRole.id],
      plannedRoleIds: [manualRole.id, communityRole.id],
      removedRoleIds: [manualRole.id, communityRole.id],
    });
    const service = new RoleQuarantineService(
      createConfigService({
        role_quarantine_mode: 'on',
        manual_intake_enabled: true,
        manual_intake_role_id: manualRole.id,
      }),
      snapshots
    );

    const result = await service.restoreMemberRoles(member);

    expect(result.restoredRoleIds).toEqual(['community-role']);
    expect(result.skippedRoles).toEqual(
      expect.arrayContaining([expect.objectContaining({ role_id: manualRole.id })])
    );
    expect(member.roles.cache.has(manualRole.id)).toBe(false);
    expect(member.roles.cache.has(communityRole.id)).toBe(true);
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
      const failure = await service
        .quarantineMember(member, createVerificationEvent())
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RoleQuarantineApplyError);
      expect(failure).toEqual(
        expect.objectContaining({
          message: expect.stringContaining('Database unavailable'),
          result: expect.objectContaining({
            removedRoleIds: ['safe-role'],
            snapshotId: expect.any(String),
          }),
        })
      );
      const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
      expect(snapshot?.removed_role_ids).toEqual(['safe-role']);
      expect(member.roles.cache.has('safe-role')).toBe(false);
    } finally {
      updateSnapshot.mockRestore();
    }
  });

  it('does not let a superseded compromised-account attempt overwrite the active snapshot', async () => {
    const safeRole = createRole({ id: 'safe-role' });
    const member = createMember([safeRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      snapshots
    );
    const assertAttemptOwner = jest.fn(async () => undefined);
    jest.spyOn(snapshots, 'updateForQuarantineAttempt').mockImplementationOnce(async (id) => {
      const active = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
      if (!active) {
        throw new Error('Expected active snapshot');
      }
      await snapshots.update(active.id, { removedRoleIds: ['new-owner-role'] });
      expect(id).toBe(active.id);
      return null;
    });

    const failure = await service
      .quarantineCompromisedAccount(
        member,
        { ...createVerificationEvent(), case_kind: CaseKind.COMPROMISED_ACCOUNT },
        { id: 'moderator-1' } as User,
        { attemptId: 'attempt-1', assertOwner: assertAttemptOwner }
      )
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RoleQuarantineApplyError);
    expect(assertAttemptOwner).toHaveBeenCalledTimes(3);
    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.removed_role_ids).toEqual(['new-owner-role']);
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

  it('clears a transient removal failure after a compromised-account retry succeeds', async () => {
    const role = createRole({ id: 'retry-role' });
    const member = createMember([role]);
    (member.roles.remove as jest.Mock).mockRejectedValueOnce(new Error('Discord unavailable'));
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      snapshots
    );
    const verificationEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    };

    const first = await service.quarantineCompromisedAccount(
      member,
      verificationEvent,
      { id: 'moderator-1' } as User,
      { attemptId: 'attempt-1', assertOwner: async () => undefined }
    );
    const second = await service.quarantineCompromisedAccount(
      member,
      verificationEvent,
      { id: 'moderator-1' } as User,
      { attemptId: 'attempt-2', assertOwner: async () => undefined }
    );

    expect(first.failedRemovals).toEqual([
      expect.objectContaining({ role_id: role.id, reason: 'Discord unavailable' }),
    ]);
    expect(second.failedRemovals).toEqual([]);
    expect(second.removedRoleIds).toEqual([role.id]);
    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.failed_removals).toEqual([]);
  });

  it('relinks an upgraded active snapshot to the current compromised-account case', async () => {
    const role = createRole({ id: 'current-role' });
    const member = createMember([role]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    await snapshots.create({
      serverId: 'guild-1',
      userId: 'user-1',
      verificationEventId: 'older-case',
      mode: 'on',
      originalRoleIds: ['older-role'],
      plannedRoleIds: ['older-role'],
      removedRoleIds: ['older-role'],
    });
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      snapshots
    );
    const verificationEvent = {
      ...createVerificationEvent(),
      id: 'current-case',
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
    };

    await service.quarantineCompromisedAccount(
      member,
      verificationEvent,
      { id: 'moderator-1' } as User,
      { attemptId: 'attempt-1', assertOwner: async () => undefined }
    );

    const snapshot = await snapshots.findActiveByServerAndUser('guild-1', 'user-1');
    expect(snapshot?.verification_event_id).toBe('current-case');
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

  it('restores the required case role when it is removed from a parked account', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const oldMember = createMember([caseRole], [caseRole]);
    const newMember = createMember([], [caseRole]);
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      new InMemoryRoleQuarantineSnapshotRepository()
    );
    const parkedEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    } as VerificationEvent;

    const result = await service.enforceActiveCaseRoleUpdate(oldMember, newMember, parkedEvent);

    expect(newMember.roles.add).toHaveBeenCalledWith(
      caseRole,
      `Restore compromised-account quarantine for case ${parkedEvent.id}`
    );
    expect(newMember.roles.cache.has(caseRole.id)).toBe(true);
    expect(result.containmentRegressed).toBe(false);
  });

  it('returns a parked account to review when the removed case role cannot be restored', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const oldMember = createMember([caseRole], [caseRole]);
    const newMember = createMember([], [caseRole]);
    (newMember.roles.add as jest.Mock).mockRejectedValue(new Error('Missing permissions'));
    const verificationEventRepository = {
      update: jest.fn().mockResolvedValue(createVerificationEvent()),
    };
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'off' }),
      new InMemoryRoleQuarantineSnapshotRepository(),
      verificationEventRepository as any
    );
    const parkedEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    } as VerificationEvent;

    const result = await service.enforceActiveCaseRoleUpdate(oldMember, newMember, parkedEvent);

    expect(result.containmentRegressed).toBe(true);
    expect(verificationEventRepository.update).toHaveBeenCalledWith(parkedEvent.id, {
      attention_state: CaseAttentionState.REVIEW_REQUIRED,
      containment_status: CaseContainmentStatus.INCOMPLETE,
      parked_at: null,
      parked_by: null,
    });
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

  it('keeps a compromised account parked when a harmless managed role cannot be removed', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const managedRole = createRole({ id: 'managed-role', managed: true });
    const oldMember = createMember([caseRole], [caseRole, managedRole]);
    const newMember = createMember([caseRole, managedRole], [caseRole, managedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const verificationEventRepository = {
      update: jest.fn().mockImplementation(async (_id, data) => ({
        ...createVerificationEvent(),
        ...data,
      })),
    };
    const lockdown = {
      auditMemberBypasses: jest.fn().mockResolvedValue({
        memberId: 'user-1',
        bypasses: [],
        retainedPrivilegedRoleIds: [],
        retainedAdministratorRoleIds: [],
        unremovablePrivilegeReasons: [],
      }),
    };
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots,
      verificationEventRepository as any,
      lockdown as any
    );
    const parkedEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    } as VerificationEvent;

    const result = await service.enforceActiveCaseRoleUpdate(oldMember, newMember, parkedEvent);

    expect(result.skippedRoles).toEqual([expect.objectContaining({ role_id: 'managed-role' })]);
    expect(lockdown.auditMemberBypasses).toHaveBeenCalledWith(newMember, new Set(), null);
    expect(verificationEventRepository.update).not.toHaveBeenCalledWith(
      parkedEvent.id,
      expect.objectContaining({ attention_state: CaseAttentionState.REVIEW_REQUIRED })
    );
  });

  it('unparks a compromised account when an unremovable role has a live bypass', async () => {
    const caseRole = createRole({ id: 'case-role' });
    const managedRole = createRole({
      id: 'managed-role',
      managed: true,
      permissions: [PermissionFlagsBits.Administrator],
    });
    const oldMember = createMember([caseRole], [caseRole, managedRole]);
    const newMember = createMember([caseRole, managedRole], [caseRole, managedRole]);
    const snapshots = new InMemoryRoleQuarantineSnapshotRepository();
    const verificationEventRepository = {
      update: jest.fn().mockImplementation(async (_id, data) => ({
        ...createVerificationEvent(),
        ...data,
      })),
    };
    const lockdown = {
      auditMemberBypasses: jest.fn().mockResolvedValue({
        memberId: 'user-1',
        bypasses: [],
        retainedPrivilegedRoleIds: ['managed-role'],
        retainedAdministratorRoleIds: ['managed-role'],
        unremovablePrivilegeReasons: [],
      }),
    };
    const service = new RoleQuarantineService(
      createConfigService({ role_quarantine_mode: 'on' }),
      snapshots,
      verificationEventRepository as any,
      lockdown as any
    );
    const parkedEvent = {
      ...createVerificationEvent(),
      case_kind: CaseKind.COMPROMISED_ACCOUNT,
      attention_state: CaseAttentionState.PARKED,
      containment_status: CaseContainmentStatus.CONTAINED,
    } as VerificationEvent;

    await service.enforceActiveCaseRoleUpdate(oldMember, newMember, parkedEvent);

    expect(verificationEventRepository.update).toHaveBeenCalledWith(
      parkedEvent.id,
      expect.objectContaining({
        attention_state: CaseAttentionState.REVIEW_REQUIRED,
        containment_status: CaseContainmentStatus.INCOMPLETE,
        parked_at: null,
        parked_by: null,
      })
    );
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
        role_quarantine_mode: 'on',
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
