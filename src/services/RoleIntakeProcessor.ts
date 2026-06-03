import type { GuildMember, Role, User } from 'discord.js';
import type { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type {
  AdminCaseOptions,
  AdminCaseResult,
  RoleIntakeOptions,
  RoleIntakeResult,
} from './SecurityActionService';

type OpenAdminCase = (
  member: GuildMember,
  moderator: User,
  options: AdminCaseOptions
) => Promise<AdminCaseResult>;

interface RoleIntakeMemberSelection {
  totalMembers: number;
  eligibleMembers: number;
  selectedMembers: GuildMember[];
  skippedBots: number;
  skippedOverLimit: number;
}

export class RoleIntakeProcessor {
  public constructor(
    private readonly verificationEventRepository: Pick<
      IVerificationEventRepository,
      'findActiveByUserAndServer'
    >,
    private readonly openAdminCase: OpenAdminCase
  ) {}

  public async intakeRoleMembers(options: RoleIntakeOptions): Promise<RoleIntakeResult> {
    const batchId = `role-intake-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const limit = Math.max(1, Math.min(options.limit ?? 250, 250));
    const delayMs = Math.max(0, options.delayMs ?? 250);
    const memberSelection = await this.selectRoleMembersForIntake(options.role, limit);
    const { selectedMembers } = memberSelection;
    const result: RoleIntakeResult = {
      batchId,
      roleId: options.role.id,
      roleName: options.role.name,
      action: options.action,
      execute: options.execute,
      totalMembers: memberSelection.totalMembers,
      eligibleMembers: memberSelection.eligibleMembers,
      processed: selectedMembers.length,
      opened: 0,
      skippedBots: memberSelection.skippedBots,
      skippedActiveCases: 0,
      skippedOverLimit: memberSelection.skippedOverLimit,
      failed: 0,
      failures: [],
    };

    for (const member of selectedMembers) {
      const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
        member.id,
        member.guild.id
      );
      if (activeCase && options.action !== 'restrict') {
        result.skippedActiveCases += 1;
        continue;
      }

      if (!options.execute) {
        continue;
      }

      try {
        const caseResult = await this.openAdminCase(member, options.moderator, {
          action: options.action,
          reason: options.reason,
          metadata: {
            type: 'admin_role_intake',
            bulk_intake: true,
            batchId,
            sourceRoleId: options.role.id,
            sourceRoleName: options.role.name,
          },
        });
        if (caseResult.opened) {
          result.opened += 1;
          if (options.action === 'restrict' && !caseResult.restricted) {
            result.failed += 1;
            result.failures.push({
              userId: member.id,
              message: 'Case opened but restriction failed',
            });
          }
        } else {
          result.failed += 1;
          result.failures.push({ userId: member.id, message: 'Case flow returned false' });
        }
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          userId: member.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
    }

    return result;
  }

  private async selectRoleMembersForIntake(
    role: Role,
    limit: number
  ): Promise<RoleIntakeMemberSelection> {
    const selectedMembers: GuildMember[] = [];
    let totalMembers = 0;
    let eligibleMembers = 0;
    let skippedBots = 0;
    let skippedOverLimit = 0;
    let after: string | undefined;
    let hasMoreMembers = true;

    while (hasMoreMembers) {
      const page = await role.guild.members.list({ after, limit: 1000, cache: false });
      if (page.size === 0) {
        break;
      }

      const pageMembers = [...page.values()].sort((a, b) => a.id.localeCompare(b.id));
      for (const member of pageMembers) {
        if (!member.roles.cache.has(role.id)) {
          continue;
        }

        totalMembers += 1;
        if (member.user.bot) {
          skippedBots += 1;
          continue;
        }

        eligibleMembers += 1;
        if (selectedMembers.length < limit) {
          selectedMembers.push(member);
        } else {
          skippedOverLimit += 1;
        }
      }

      after = pageMembers[pageMembers.length - 1]?.id;
      if (!after || page.size < 1000) {
        hasMoreMembers = false;
      }
    }

    return { totalMembers, eligibleMembers, selectedMembers, skippedBots, skippedOverLimit };
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}
