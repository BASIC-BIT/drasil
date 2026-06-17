import type { GuildMember, Role, User } from 'discord.js';
import type { IVerificationEventRepository } from '../repositories/VerificationEventRepository';
import type {
  AdminCaseOptions,
  AdminCaseResult,
  RoleIntakeFailure,
  RoleIntakeOptions,
  RoleIntakeProgress,
  RoleIntakeResult,
} from './SecurityActionService';

const DEFAULT_ROLE_INTAKE_MEMBER_TIMEOUT_MS = 60_000;

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

interface RoleIntakeMemberResult {
  opened: number;
  skippedActiveCases: number;
  failed: number;
  failures: RoleIntakeFailure[];
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
    const memberTimeoutMs = Math.max(
      1,
      options.memberTimeoutMs ?? DEFAULT_ROLE_INTAKE_MEMBER_TIMEOUT_MS
    );
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

    let completedMembers = 0;
    for (const member of selectedMembers) {
      try {
        const memberResult = await this.withTimeout(
          this.processSelectedMember(options, member, batchId),
          memberTimeoutMs,
          `Role intake for ${member.id}`
        );
        this.applyMemberResult(result, memberResult);
      } catch (error) {
        result.failed += 1;
        result.failures.push({
          userId: member.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      completedMembers += 1;
      await this.reportProgress(options, result, completedMembers);

      if (delayMs > 0) {
        await this.sleep(delayMs);
      }
    }

    return result;
  }

  private async processSelectedMember(
    options: RoleIntakeOptions,
    member: GuildMember,
    batchId: string
  ): Promise<RoleIntakeMemberResult> {
    const memberResult: RoleIntakeMemberResult = {
      opened: 0,
      skippedActiveCases: 0,
      failed: 0,
      failures: [],
    };

    const activeCase = await this.verificationEventRepository.findActiveByUserAndServer(
      member.id,
      member.guild.id
    );
    if (activeCase) {
      memberResult.skippedActiveCases += 1;
      return memberResult;
    }

    if (!options.execute) {
      return memberResult;
    }

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
      memberResult.opened += 1;
      if (!caseResult.caseRoleActive) {
        memberResult.failed += 1;
        memberResult.failures.push({
          userId: member.id,
          message: 'Case opened but case role failed',
        });
      }
      return memberResult;
    }

    memberResult.failed += 1;
    memberResult.failures.push({ userId: member.id, message: 'Case flow returned false' });
    return memberResult;
  }

  private applyMemberResult(result: RoleIntakeResult, memberResult: RoleIntakeMemberResult): void {
    result.opened += memberResult.opened;
    result.skippedActiveCases += memberResult.skippedActiveCases;
    result.failed += memberResult.failed;
    result.failures.push(...memberResult.failures);
  }

  private async reportProgress(
    options: RoleIntakeOptions,
    result: RoleIntakeResult,
    completedMembers: number
  ): Promise<void> {
    if (!options.onProgress) {
      return;
    }

    const progress: RoleIntakeProgress = {
      result: {
        ...result,
        failures: [...result.failures],
      },
      completedMembers,
    };

    try {
      await options.onProgress(progress);
    } catch (error) {
      console.warn(`Failed to publish role intake progress for batch ${result.batchId}:`, error);
    }
  }

  private async withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    description: string
  ): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeout = setTimeout(() => {
        reject(
          new Error(
            `${description} did not finish within ${Math.ceil(timeoutMs / 1000)}s; it may still complete in the background.`
          )
        );
      }, timeoutMs);
      timeout.unref();
    });

    try {
      return await Promise.race([operation, timeoutPromise]);
    } finally {
      void operation.catch(() => undefined);
      if (timeout) {
        clearTimeout(timeout);
      }
    }
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
