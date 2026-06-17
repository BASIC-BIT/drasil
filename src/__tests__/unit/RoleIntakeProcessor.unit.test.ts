import { Guild, GuildMember, Role, User } from 'discord.js';
import { VerificationStatus } from '../../repositories/types';
import type { AdminCaseResult } from '../../services/SecurityActionService';
import { RoleIntakeProcessor } from '../../services/RoleIntakeProcessor';

const buildMember = (guildId: string, userId: string, bot = false): GuildMember =>
  ({
    id: userId,
    guild: { id: guildId } as Guild,
    user: {
      id: userId,
      username: 'test-user',
      tag: 'test-user#0001',
      bot,
    } as User,
  }) as unknown as GuildMember;

const addRoleToMember = (member: GuildMember, roleId: string): void => {
  (member as any).roles = { cache: { has: jest.fn((id: string) => id === roleId) } };
};

const buildRole = (guildId: string, members: GuildMember[]): Role => {
  const guild = {
    id: guildId,
    members: {
      list: jest.fn().mockResolvedValue(new Map(members.map((member) => [member.id, member]))),
    },
  } as unknown as Guild;

  for (const member of members) {
    (member as any).guild = guild;
    addRoleToMember(member, 'role-restricted');
  }

  return {
    id: 'role-restricted',
    name: 'restricted',
    guild,
  } as unknown as Role;
};

describe('RoleIntakeProcessor (unit)', () => {
  const moderator = { id: 'admin-role-intake' } as User;

  it('dry-runs role intake while skipping bots, active cases, and over-limit members', async () => {
    const guildId = 'guild-role-intake-dry-run';
    const activeMember = buildMember(guildId, 'user-active');
    const selectedMember = buildMember(guildId, 'user-selected');
    const overLimitMember = buildMember(guildId, 'user-over-limit');
    const botMember = buildMember(guildId, 'user-bot', true);
    const role = buildRole(guildId, [activeMember, selectedMember, overLimitMember, botMember]);
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn(async (userId: string) =>
        userId === activeMember.id
          ? ({ id: 'ver-active', status: VerificationStatus.PENDING } as any)
          : null
      ),
    };
    const openAdminCase = jest.fn();
    const processor = new RoleIntakeProcessor(verificationEventRepository, openAdminCase);

    const result = await processor.intakeRoleMembers({
      role,
      moderator,
      action: 'open_case',
      execute: false,
      limit: 2,
      delayMs: 0,
    });

    expect(role.guild.members.list).toHaveBeenCalledWith({
      after: undefined,
      limit: 1000,
      cache: false,
    });
    expect(result).toMatchObject({
      roleId: 'role-restricted',
      roleName: 'restricted',
      execute: false,
      totalMembers: 4,
      eligibleMembers: 3,
      processed: 2,
      opened: 0,
      skippedBots: 1,
      skippedActiveCases: 1,
      skippedOverLimit: 1,
      failed: 0,
    });
    expect(openAdminCase).not.toHaveBeenCalled();
  });

  it('executes role intake and passes batch provenance metadata', async () => {
    const guildId = 'guild-role-intake-execute';
    const member = buildMember(guildId, 'user-role-intake');
    const role = buildRole(guildId, [member]);
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(null),
    };
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: true,
    });
    const processor = new RoleIntakeProcessor(verificationEventRepository, openAdminCase);

    const result = await processor.intakeRoleMembers({
      role,
      moderator,
      action: 'open_case',
      execute: true,
      reason: 'restricted role import',
      delayMs: 0,
    });

    expect(result.opened).toBe(1);
    expect(result.failed).toBe(0);
    expect(openAdminCase).toHaveBeenCalledWith(member, moderator, {
      action: 'open_case',
      reason: 'restricted role import',
      metadata: {
        type: 'admin_role_intake',
        bulk_intake: true,
        batchId: result.batchId,
        sourceRoleId: 'role-restricted',
        sourceRoleName: 'restricted',
      },
    });
  });

  it('skips active cases during role intake', async () => {
    const guildId = 'guild-role-intake-restrict-active';
    const member = buildMember(guildId, 'user-role-intake-active');
    const role = buildRole(guildId, [member]);
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue({
        id: 'ver-active',
        status: VerificationStatus.PENDING,
      } as any),
    };
    const openAdminCase = jest.fn().mockResolvedValue({
      opened: true,
      restrictionAttempted: true,
      restricted: true,
    });
    const processor = new RoleIntakeProcessor(verificationEventRepository, openAdminCase);

    const result = await processor.intakeRoleMembers({
      role,
      moderator,
      action: 'open_case',
      execute: true,
      delayMs: 0,
    });

    expect(result.opened).toBe(0);
    expect(result.skippedActiveCases).toBe(1);
    expect(openAdminCase).not.toHaveBeenCalled();
  });

  it('records a failure and continues when one role intake member times out', async () => {
    const guildId = 'guild-role-intake-timeout';
    const hangingMember = buildMember(guildId, 'user-hangs');
    const okMember = buildMember(guildId, 'user-ok');
    const role = buildRole(guildId, [hangingMember, okMember]);
    const verificationEventRepository = {
      findActiveByUserAndServer: jest.fn().mockResolvedValue(null),
    };
    const openAdminCase = jest.fn((member: GuildMember): Promise<AdminCaseResult> => {
      if (member.id === hangingMember.id) {
        return new Promise<AdminCaseResult>(() => undefined);
      }

      return Promise.resolve({
        opened: true,
        restrictionAttempted: true,
        restricted: true,
      });
    });
    const onProgress = jest.fn();
    const processor = new RoleIntakeProcessor(verificationEventRepository, openAdminCase);

    const result = await processor.intakeRoleMembers({
      role,
      moderator,
      action: 'open_case',
      execute: true,
      delayMs: 0,
      memberTimeoutMs: 1,
      onProgress,
    });

    expect(result.opened).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        userId: hangingMember.id,
        message: expect.stringContaining('did not finish'),
      }),
    ]);
    expect(openAdminCase).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        completedMembers: 2,
        result: expect.objectContaining({ opened: 1, failed: 1 }),
      })
    );
  });
});
