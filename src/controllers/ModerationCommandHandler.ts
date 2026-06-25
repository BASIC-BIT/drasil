import {
  ButtonStyle,
  ChatInputCommandInteraction,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import {
  CaseThreadClosureSweepReport,
  ICaseThreadClosureSweepService,
} from '../services/CaseThreadClosureSweepService';
import {
  IIntegrityAuditService,
  IntegrityAuditFinding,
  IntegrityAuditReport,
} from '../services/IntegrityAuditService';
import { ISecurityActionService } from '../services/SecurityActionService';
import { IUserModerationService } from '../services/UserModerationService';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { requestSlashCommandConfirmation } from '../utils/slashCommandConfirmations';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;

const AUDIT_INTEGRITY_RESPONSE_MAX_LENGTH = 1900;

export class ModerationCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly userModerationService: IUserModerationService,
    private readonly securityActionService: ISecurityActionService,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired,
    private readonly integrityAuditService?: IIntegrityAuditService,
    private readonly caseThreadClosureSweepService?: ICaseThreadClosureSweepService
  ) {}

  public async handleBanCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const targetUser = interaction.options.getUser('user');
    if (!targetUser) {
      await interaction.reply({
        content: 'You must specify a user to ban.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.options.getString('reason') || 'No reason provided';
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasBanPermission = interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers);
    if (hasBanPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasBanPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.BanMembers)
        : false;
    }

    if (!hasBanPermission) {
      await interaction.reply({
        content: 'You need Ban Members permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!(await this.canUseModeratorBanAction(guild))) {
      await interaction.reply({
        content:
          'Drasil ban actions are disabled for this server or the bot lacks Ban Members permission.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await guild.members.fetch(targetUser.id).catch(() => null);

    await requestSlashCommandConfirmation(interaction, {
      message: member
        ? `Ban ${targetUser.tag} from this server?`
        : `Ban ${targetUser.tag} from this server by ID?`,
      confirmLabel: member ? 'Ban User' : 'Ban by ID',
      confirmStyle: ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({ content: `Banning ${targetUser.tag}...`, components: [] });
        try {
          if (member) {
            await this.userModerationService.banUser(member, reason, interaction.user);
          } else {
            await this.userModerationService.banUserById(
              guild,
              targetUser.id,
              reason,
              interaction.user
            );
          }
          await buttonInteraction.editReply({ content: `User ${targetUser.tag} has been banned.` });
        } catch (error) {
          console.error('Failed to ban user via command:', error);
          await buttonInteraction.editReply({
            content: `Failed to ban ${targetUser.tag}. Please try again later.`,
          });
        }
      },
    });
  }

  public async handleAuditCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasManageGuildPermission = interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    );
    if (hasManageGuildPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      hasManageGuildPermission = invokingMember
        ? invokingMember.permissionsIn(interaction.channelId).has(PermissionFlagsBits.ManageGuild)
        : false;
    }

    if (!hasManageGuildPermission) {
      await interaction.reply({
        content: 'You need Manage Server permission to audit detection accounting.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true);
    if (subcommand === 'integrity') {
      await this.handleIntegrityAuditCommand(interaction, guild);
      return;
    }

    if (subcommand === 'close-resolved-threads') {
      await this.handleCloseResolvedThreadsCommand(interaction, guild);
      return;
    }

    const detectionEventId = interaction.options.getString('detection-id', true).trim();
    const reason = interaction.options.getString('reason')?.trim() || undefined;

    if (subcommand !== 'ignore-detection' && subcommand !== 'restore-detection') {
      await interaction.reply({
        content: 'Unsupported /audit subcommand.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const isRestore = subcommand === 'restore-detection';
    await requestSlashCommandConfirmation(interaction, {
      message: `${isRestore ? 'Restore' : 'Ignore'} detection ${detectionEventId} for future accounting?`,
      confirmLabel: isRestore ? 'Restore Detection' : 'Ignore Detection',
      confirmStyle: isRestore ? ButtonStyle.Success : ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: `${isRestore ? 'Restoring' : 'Ignoring'} detection ${detectionEventId}...`,
          components: [],
        });
        try {
          const updatedDetection = isRestore
            ? await this.securityActionService.restoreDetectionAccounting(
                guild.id,
                detectionEventId,
                interaction.user,
                reason
              )
            : await this.securityActionService.excludeDetectionFromAccounting(
                guild.id,
                detectionEventId,
                interaction.user,
                reason
              );
          await buttonInteraction.editReply({
            content: updatedDetection
              ? isRestore
                ? `Detection ${detectionEventId} now counts toward future accounting again.`
                : `Detection ${detectionEventId} is now ignored for future accounting.`
              : `Detection ${detectionEventId} was not found or is not auditable from this server.`,
          });
        } catch (error) {
          console.error(`Failed to audit detection ${detectionEventId}:`, error);
          await buttonInteraction.editReply({
            content: 'Failed to update detection accounting. Please try again later.',
          });
        }
      },
    });
  }

  public async handleFlagUserCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({
        content: 'You need administrator permissions to use this command.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');

    const targetMember = await guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({
        content: `Could not find user ${targetUser.tag} in this server.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await requestSlashCommandConfirmation(interaction, {
      message: `Flag ${targetUser.tag} and restrict them pending moderator review?`,
      confirmLabel: 'Flag User',
      confirmStyle: ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: `Flagging ${targetUser.tag}...`,
          components: [],
        });
        try {
          await this.securityActionService.handleManualFlag(
            targetMember,
            interaction.user,
            reason ?? undefined
          );
          await buttonInteraction.editReply({
            content: `Flag request for ${targetUser.tag} received. Initiating verification process...`,
          });
        } catch (error) {
          console.error('Failed to manually flag user:', error);
          await buttonInteraction.editReply({
            content: `Failed to flag ${targetUser.tag}. Please try again later.`,
          });
        }
      },
    });
  }

  private async canUseModeratorBanAction(guild: Guild): Promise<boolean> {
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const settings = getDetectionResponseSettings(serverConfig.settings);
    if (!settings.moderatorBanActionEnabled) {
      return false;
    }

    const botMember =
      guild.members.me ??
      (typeof guild.members.fetchMe === 'function'
        ? await guild.members.fetchMe().catch(() => null)
        : null);
    return botMember?.permissions.has(PermissionFlagsBits.BanMembers) ?? false;
  }

  private async handleIntegrityAuditCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    if (!this.integrityAuditService) {
      await interaction.reply({
        content: 'Integrity audit is not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const report = await this.integrityAuditService.auditGuild(guild, {
        scope: interaction.options.getString('scope'),
        days: interaction.options.getInteger('days'),
        limit: interaction.options.getInteger('limit'),
        userId: interaction.options.getUser('user')?.id,
      });

      await interaction.editReply({ content: this.formatIntegrityAuditReport(report) });
    } catch (error) {
      console.error(`Failed to run integrity audit for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: 'Failed to run the integrity audit. No repair actions were applied.',
      });
    }
  }

  private async handleCloseResolvedThreadsCommand(
    interaction: ChatInputCommandInteraction,
    guild: Guild
  ): Promise<void> {
    const caseThreadClosureSweepService = this.caseThreadClosureSweepService;
    if (!caseThreadClosureSweepService) {
      await interaction.reply({
        content: 'Resolved-thread sweep is not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const execute = interaction.options.getBoolean('execute') === true;
    const days = interaction.options.getInteger('days') ?? 30;
    const limit = interaction.options.getInteger('limit') ?? 100;
    const userId = interaction.options.getUser('user')?.id ?? null;
    const runSweep = async (): Promise<CaseThreadClosureSweepReport> =>
      caseThreadClosureSweepService.sweepResolvedCaseThreads({
        serverId: guild.id,
        execute,
        days,
        limit,
        userId,
      });

    if (!execute) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await runSweep();
      await interaction.editReply({ content: this.formatThreadClosureSweepReport(report) });
      return;
    }

    await requestSlashCommandConfirmation(interaction, {
      message: `Close resolved case threads that are still open? This will inspect up to ${limit} resolved case(s) from the last ${days} day(s).`,
      confirmLabel: 'Close Threads',
      confirmStyle: ButtonStyle.Danger,
      execute: async (buttonInteraction) => {
        await buttonInteraction.update({
          content: 'Closing resolved case threads...',
          components: [],
        });
        const report = await runSweep();
        await buttonInteraction.editReply({ content: this.formatThreadClosureSweepReport(report) });
      },
    });
  }

  private formatIntegrityAuditReport(report: IntegrityAuditReport): string {
    const severityCounts = this.countFindingsBySeverity(report.findings);
    const lines = [
      'Moderation integrity audit complete. No repair actions were applied.',
      `Scope: ${report.scope}; lookback: ${report.days} days; limit: ${report.limit}${report.userId ? `; user: <@${report.userId}>` : ''}.`,
      `Checked: ${report.candidateCounts.pendingCases} pending cases, ${report.candidateCounts.recentResolvedCases} recent resolved cases, ${report.candidateCounts.caseRoleMembers} case-role members, ${report.candidateCounts.activeRoleQuarantines} active role quarantines, ${report.candidateCounts.queueItems} queue items.`,
      `Findings: ${severityCounts.error} errors, ${severityCounts.warning} warnings, ${severityCounts.info} info.`,
    ];

    if (report.findings.length === 0) {
      lines.push('No integrity findings found for the selected scope.');
      return lines.join('\n');
    }

    lines.push('', 'Top findings:');
    for (const finding of report.findings.slice(0, 12)) {
      lines.push(this.formatIntegrityFinding(finding));
    }
    if (report.findings.length > 12) {
      lines.push(`...and ${report.findings.length - 12} more findings.`);
    }

    const response = lines.join('\n');
    return response.length <= AUDIT_INTEGRITY_RESPONSE_MAX_LENGTH
      ? response
      : `${response.slice(0, AUDIT_INTEGRITY_RESPONSE_MAX_LENGTH - 3)}...`;
  }

  private formatIntegrityFinding(finding: IntegrityAuditFinding): string {
    return `- [${finding.severity}] ${finding.code}: ${finding.subject} - ${finding.detail}`;
  }

  private formatThreadClosureSweepReport(report: CaseThreadClosureSweepReport): string {
    const lines = [
      report.execute
        ? 'Resolved case thread sweep complete.'
        : 'Resolved case thread sweep dry-run complete. No repair actions were applied.',
      `Lookback: ${report.days} days; limit: ${report.limit}.`,
      `Checked: ${report.checkedCases} case(s), ${report.checkedThreads} thread(s).`,
      report.execute
        ? `Closed: ${report.closedThreads}; already closed: ${report.alreadyClosedThreads}; missing: ${report.missingThreads}; failed: ${report.failedThreads}.`
        : `Would close: ${report.wouldCloseThreads}; already closed: ${report.alreadyClosedThreads}; missing: ${report.missingThreads}; failed: ${report.failedThreads}.`,
    ];

    const notableCases = report.cases
      .filter((caseResult) =>
        caseResult.threadResults.some(
          (threadResult) => threadResult.wouldClose || threadResult.missing || threadResult.error
        )
      )
      .slice(0, 8);

    if (notableCases.length > 0) {
      lines.push('', 'Notable cases:');
      for (const caseResult of notableCases) {
        const threadSummary = caseResult.threadResults
          .map((threadResult) => {
            if (threadResult.error) {
              return `${threadResult.threadKind} failed`;
            }
            if (threadResult.missing) {
              return `${threadResult.threadKind} missing`;
            }
            if (threadResult.closed) {
              return `${threadResult.threadKind} closed`;
            }
            if (threadResult.wouldClose) {
              return `${threadResult.threadKind} would close`;
            }
            return `${threadResult.threadKind} already closed`;
          })
          .join(', ');
        lines.push(
          `- ${caseResult.verificationEventId} for <@${caseResult.userId}>: ${threadSummary}`
        );
      }
    }

    const response = lines.join('\n');
    return response.length <= AUDIT_INTEGRITY_RESPONSE_MAX_LENGTH
      ? response
      : `${response.slice(0, AUDIT_INTEGRITY_RESPONSE_MAX_LENGTH - 3)}...`;
  }

  private countFindingsBySeverity(
    findings: IntegrityAuditFinding[]
  ): Record<'error' | 'warning' | 'info', number> {
    return findings.reduce(
      (counts, finding) => ({
        ...counts,
        [finding.severity]: counts[finding.severity] + 1,
      }),
      { error: 0, warning: 0, info: 0 }
    );
  }
}
