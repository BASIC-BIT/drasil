import type { APIUser, Guild, GuildMember, User } from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import {
  DEFAULT_USER_REPORT_REASON_REQUIRED,
  getUserReportSettings,
} from '../utils/userReportSettings';
import { ISecurityActionService, MessageReportContext } from './SecurityActionService';

export type UserReportSubmissionResult =
  | { status: 'submitted'; targetUserId: string }
  | { status: 'self_report' }
  | { status: 'reason_required' }
  | { status: 'member_not_found'; label: string }
  | { status: 'failed'; error: unknown };

export interface SubmitUserReportInput {
  guild: Guild;
  reporter: User;
  targetUserId: string;
  targetLabel: string;
  reason?: string;
  passUndefinedReason?: boolean;
}

export class ReportSubmissionService {
  public constructor(
    private readonly configService: IConfigService,
    private readonly securityActionService: ISecurityActionService
  ) {}

  public async getReasonRequired(guildId: string | undefined): Promise<boolean> {
    if (!guildId) {
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }

    try {
      const serverConfig = await this.configService.getServerConfig(guildId);
      return getUserReportSettings(serverConfig.settings).reasonRequired;
    } catch (error) {
      console.error(`Failed to load report settings for guild ${guildId}:`, error);
      return DEFAULT_USER_REPORT_REASON_REQUIRED;
    }
  }

  public async submitUserReport(input: SubmitUserReportInput): Promise<UserReportSubmissionResult> {
    if (input.targetUserId === input.reporter.id) {
      return { status: 'self_report' };
    }

    const reasonRequired = await this.getReasonRequired(input.guild.id);
    if (reasonRequired && !input.reason) {
      return { status: 'reason_required' };
    }

    const member = await input.guild.members.fetch(input.targetUserId).catch(() => null);
    if (!member) {
      return { status: 'member_not_found', label: input.targetLabel };
    }

    try {
      return await this.submitResolvedUserReport(member, input.reporter, input.reason, {
        passUndefinedReason: input.passUndefinedReason === true,
      });
    } catch (error) {
      return { status: 'failed', error };
    }
  }

  public async submitResolvedUserReport(
    member: GuildMember,
    reporter: User,
    reason?: string,
    options?: { passUndefinedReason?: boolean }
  ): Promise<Extract<UserReportSubmissionResult, { status: 'submitted' | 'failed' }>> {
    try {
      if (reason === undefined && !options?.passUndefinedReason) {
        await this.securityActionService.handleUserReport(member, reporter);
      } else {
        await this.securityActionService.handleUserReport(member, reporter, reason);
      }
      return { status: 'submitted', targetUserId: member.id };
    } catch (error) {
      return { status: 'failed', error };
    }
  }

  public async submitMessageReport(
    targetUser: User | APIUser,
    reporter: User | APIUser,
    report: MessageReportContext
  ): Promise<{ status: 'submitted' } | { status: 'failed'; error: unknown }> {
    try {
      await this.securityActionService.handleMessageReport(targetUser, reporter, report);
      return { status: 'submitted' };
    } catch (error) {
      return { status: 'failed', error };
    }
  }
}
