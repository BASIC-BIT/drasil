import { requireSetupOutcome } from '../application/adapters/setup';
import { createDiscordActionContext } from '../application/context';
import type { BotApplication } from '../application/createBotApplication';
import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  Role,
  TextChannel,
} from 'discord.js';
import type { DetectionResponseMode } from '../contracts/setup';
import { IConfigService } from '../config/ConfigService';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticIssue,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';
import { type SetupWorkflowResult } from '../services/SetupWorkflowService';
import { DEFAULT_VERIFICATION_CHANNEL_NAME } from '../services/SetupProvisioningService';

const DEFAULT_SETUP_FAILURE_DETAIL = 'Please check permissions and try again.';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;
type CompletedSetupWorkflowResult = Extract<SetupWorkflowResult, { status: 'completed' }>;
type ConfigSetupReportInstructionsStatus = {
  line: string | null;
  warningLine: string | null;
};

export class SetupCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService | undefined,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired,
    private readonly application?: BotApplication
  ) {}

  public async handleSetupVerificationCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    const hasAdminPermission = await this.hasSetupAdminPermission(interaction, guild);

    if (!hasAdminPermission) {
      await interaction.reply({
        content: 'You need administrator permissions to set up the verification channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.setupDiagnosticsService || !this.application) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = DEFAULT_SETUP_FAILURE_DETAIL;

    try {
      const caseRole = interaction.options.getRole('case-role', true);
      const adminChannel = interaction.options.getChannel('admin-channel', true);
      const verificationChannel = interaction.options.getChannel('verification-channel');

      if (adminChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Admin channel must be a text channel.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (verificationChannel && verificationChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          content: 'Verification channel must be a text channel.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const outcome = requireSetupOutcome(
        await this.application.setupRuntime.execute(
          createDiscordActionContext({
            guildId: guild.id,
            userId: interaction.user.id,
            requestId: interaction.id,
          }),
          {
            kind: 'complete_setup_verification',
            mode: 'provision',
            adminChannelId: adminChannel.id,
            caseRoleId: caseRole.id,
            verificationChannelId: verificationChannel?.id ?? null,
            reportInstructionsChannelId: null,
            onboardingWizard: false,
          },
          {
            kind: 'direct',
            guild,
            caseRole: caseRole as Role,
            verificationChannel: verificationChannel as TextChannel | null,
            reportChannel: null,
            actorLabel: interaction.user.username,
            captureAnalytics: true,
            publishPanel: false,
          }
        )
      );
      if (outcome.kind !== 'complete_setup_verification')
        throw new Error('Setup outcome mismatch.');
      const setupResult = outcome.result;

      if (setupResult.status === 'ambiguous_case_role') {
        await interaction.editReply({
          content: 'Setup not saved. Choose one case role before rerunning setup.',
        });
        return;
      }
      if (setupResult.status === 'ambiguous_verification_channel') {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple #${DEFAULT_VERIFICATION_CHANNEL_NAME} channels already exist: ` +
            setupResult.channelIds.map((channelId) => `<#${channelId}>`).join(', ') +
            '. Choose one with `verification-channel` before rerunning setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupResult.status === 'invalid_selection') {
        await interaction.editReply({ content: `Setup not saved. ${setupResult.detail}` });
        return;
      }

      if (setupResult.status === 'candidate_validation_failed') {
        await this.editReplyWithPages(interaction, [
          'Setup not saved. Fix the errors below and rerun setup.',
          '',
          ...this.buildSetupDiagnosticsLines(setupResult.report),
        ]);
        return;
      }

      if (setupResult.status === 'final_validation_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        const rollbackNote =
          setupFailureDetail !== DEFAULT_SETUP_FAILURE_DETAIL ? `\n\n${setupFailureDetail}` : '';
        await this.editReplyWithPages(interaction, [
          `Setup not saved. Fix the errors below and rerun setup.${rollbackNote}`,
          '',
          ...this.buildSetupDiagnosticsLines(setupResult.report),
        ]);
        return;
      }

      if (setupResult.status === 'verification_channel_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        throw setupResult.error;
      }

      if (setupResult.status === 'config_save_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        throw setupResult.error;
      }

      const verificationChannelMessage =
        setupResult.verificationChannelAction === 'created'
          ? `Created verification channel: <#${setupResult.verificationChannelId}>`
          : setupResult.verificationChannelAction === 'synced'
            ? `Synced verification channel permissions: <#${setupResult.verificationChannelId}>`
            : `Verification channel: <#${setupResult.verificationChannelId}>`;

      const responseLines = [
        'Setup complete.',
        `Case role: <@&${caseRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        verificationChannelMessage,
      ];

      if (setupResult.candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsLines(responseLines, setupResult.candidateReport);
      }

      await this.editReplyWithPages(interaction, responseLines);
    } catch (error) {
      console.error('Failed to complete setup verification command:', error);
      const errorResponse = {
        content: `Failed to complete setup verification. ${setupFailureDetail}`,
      } as const;

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply(errorResponse);
      } else {
        await interaction.reply({ ...errorResponse, flags: MessageFlags.Ephemeral });
      }
    }
  }

  private async hasSetupAdminPermission(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<boolean> {
    const memberPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (memberPermission !== undefined) {
      return memberPermission;
    }

    const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (!invokingMember) {
      return false;
    }

    if (interaction.channelId) {
      return invokingMember
        .permissionsIn(interaction.channelId)
        .has(PermissionFlagsBits.Administrator);
    }

    return invokingMember.permissions.has(PermissionFlagsBits.Administrator);
  }

  public async handleConfigSetupCommand(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<void> {
    if (!this.setupDiagnosticsService || !this.application) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const adminChannel = interaction.options.getChannel('admin-channel', true);
    const existingCaseRole = interaction.options.getRole('case-role');
    const requestedRoleName = interaction.options.getString('case-role-name')?.trim() || null;
    const verificationChannel = interaction.options.getChannel('verification-channel');
    const reportChannel = interaction.options.getChannel('report-channel');
    const protectionMode = interaction.options.getString(
      'protection-mode'
    ) as DetectionResponseMode | null;

    if (
      await this.replyIfInvalidConfigSetupOptions(interaction, {
        adminChannel,
        verificationChannel,
        reportChannel,
        hasExplicitCaseRole: Boolean(existingCaseRole),
        requestedRoleName,
      })
    ) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let setupFailureDetail: string | null = null;

    try {
      const reportInstructionsStatus: ConfigSetupReportInstructionsStatus = {
        line: null,
        warningLine: null,
      };
      const outcome = requireSetupOutcome(
        await this.application.setupRuntime.execute(
          createDiscordActionContext({
            guildId: guild.id,
            userId: interaction.user.id,
            requestId: interaction.id,
          }),
          {
            kind: 'complete_setup_verification',
            mode: 'provision',
            adminChannelId: adminChannel.id,
            caseRoleId: existingCaseRole?.id ?? null,
            caseRoleName: requestedRoleName,
            verificationChannelId: verificationChannel?.id ?? null,
            reportInstructionsChannelId: reportChannel?.id ?? null,
            detectionResponseMode: protectionMode ?? undefined,
            onboardingWizard: false,
          },
          {
            kind: 'direct',
            guild,
            caseRole: existingCaseRole as Role | null,
            verificationChannel: verificationChannel as TextChannel | null,
            reportChannel: reportChannel as TextChannel | null,
            actorLabel: interaction.user.username,
            captureAnalytics: true,
            publishPanel: true,
          }
        )
      );
      if (outcome.kind !== 'complete_setup_verification')
        throw new Error('Setup outcome mismatch.');
      const setupResult = outcome.result;

      if (setupResult.status === 'ambiguous_case_role') {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple roles named \`${setupResult.roleName}\` already exist: ` +
            setupResult.roleIds.map((roleId) => `<@&${roleId}>`).join(', ') +
            '. Choose one with `case-role` before rerunning /config setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupResult.status === 'ambiguous_verification_channel') {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple #${DEFAULT_VERIFICATION_CHANNEL_NAME} channels already exist: ` +
            setupResult.channelIds.map((channelId) => `<#${channelId}>`).join(', ') +
            '. Choose one with `verification-channel` before rerunning /config setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (setupResult.status === 'invalid_selection') {
        await interaction.editReply({ content: `Setup not saved. ${setupResult.detail}` });
        return;
      }

      if (setupResult.status !== 'completed') {
        const incompleteResult = await this.resolveIncompleteConfigSetupResult(
          interaction,
          setupResult
        );
        if (incompleteResult.setupFailureDetail) {
          setupFailureDetail = incompleteResult.setupFailureDetail;
        }
        if (incompleteResult.error) {
          throw incompleteResult.error;
        }
        return;
      }

      if (reportChannel && setupResult.reportInstructions) {
        if (setupResult.reportInstructions.error)
          reportInstructionsStatus.warningLine = `[WARNING] Core setup was saved, but report instructions were not updated in <#${reportChannel.id}>. Check Drasil can send messages and embeds there, then rerun setup.`;
        else
          reportInstructionsStatus.line = `Report instructions ${setupResult.reportInstructions.action}: <#${reportChannel.id}>`;
      }

      const lines = this.buildConfigSetupSuccessLines(
        setupResult,
        adminChannel.id,
        reportInstructionsStatus
      );

      await this.editReplyWithPages(interaction, lines);
    } catch (error) {
      console.error(`Failed to complete config setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: setupFailureDetail
          ? `Failed to complete setup. ${setupFailureDetail}`
          : `Failed to complete setup. ${DEFAULT_SETUP_FAILURE_DETAIL}`,
        allowedMentions: { parse: [] },
      });
    }
  }

  private async replyIfInvalidConfigSetupOptions(
    interaction: ChatInputCommandInteraction,
    options: {
      adminChannel: { type: ChannelType };
      verificationChannel: { type: ChannelType } | null;
      reportChannel: { type: ChannelType } | null;
      hasExplicitCaseRole: boolean;
      requestedRoleName: string | null;
    }
  ): Promise<boolean> {
    if (options.adminChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Admin channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (options.verificationChannel && options.verificationChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Verification channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (options.reportChannel && options.reportChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Report channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (options.hasExplicitCaseRole && options.requestedRoleName) {
      await interaction.reply({
        content: '`case-role-name` cannot be combined with `case-role`.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  }

  private async resolveIncompleteConfigSetupResult(
    interaction: ChatInputCommandInteraction,
    setupResult: Exclude<SetupWorkflowResult, { status: 'completed' }>
  ): Promise<{ setupFailureDetail: string | null; error?: unknown }> {
    switch (setupResult.status) {
      case 'candidate_validation_failed':
        await this.editReplyWithPages(interaction, [
          'Setup not saved. Fix the errors below and rerun /config setup.',
          '',
          ...this.buildSetupDiagnosticsLines(setupResult.report),
        ]);
        return { setupFailureDetail: null };
      case 'final_validation_failed': {
        const rollbackNote =
          setupResult.setupFailureDetail !== DEFAULT_SETUP_FAILURE_DETAIL
            ? `\n\n${setupResult.setupFailureDetail}`
            : '';
        await this.editReplyWithPages(interaction, [
          `Setup not saved. Fix the errors below and rerun /config setup.${rollbackNote}`,
          '',
          ...this.buildSetupDiagnosticsLines(setupResult.report),
        ]);
        return { setupFailureDetail: setupResult.setupFailureDetail };
      }
      case 'verification_channel_failed':
      case 'config_save_failed':
        return { setupFailureDetail: setupResult.setupFailureDetail, error: setupResult.error };
    }
  }

  private buildConfigSetupSuccessLines(
    setupResult: CompletedSetupWorkflowResult,
    adminChannelId: string,
    reportInstructionsStatus: ConfigSetupReportInstructionsStatus
  ): string[] {
    const verificationChannelAction =
      setupResult.verificationChannelAction === 'created'
        ? 'Created verification channel'
        : setupResult.verificationChannelAction === 'synced'
          ? 'Synced verification channel permissions'
          : 'Verification channel';
    const lines = [
      'Setup complete.',
      `${setupResult.caseRoleWasCreated ? 'Created case role' : 'Case role'}: <@&${setupResult.caseRoleId}>`,
      `Admin channel: <#${adminChannelId}>`,
      `${verificationChannelAction}: <#${setupResult.verificationChannelId}>`,
    ];

    if (reportInstructionsStatus.line) {
      lines.push(reportInstructionsStatus.line);
    }

    if (reportInstructionsStatus.warningLine) {
      lines.push(reportInstructionsStatus.warningLine);
    }

    if (setupResult.candidateReport.warningCount > 0) {
      this.appendSetupDiagnosticsLines(lines, setupResult.candidateReport);
    }

    return lines;
  }

  public async handleConfigValidateCommand(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<void> {
    if (!this.setupDiagnosticsService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const report = await this.setupDiagnosticsService.validateGuildSetup(guild);
      await this.editReplyWithPages(interaction, this.buildSetupDiagnosticsLines(report));
    } catch (error) {
      console.error(`Failed to validate setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: 'Failed to validate setup. Please try again later.',
      });
    }
  }

  private buildSetupDiagnosticsLines(report: SetupDiagnosticReport): string[] {
    const status =
      report.errorCount > 0
        ? `Setup validation failed with ${report.errorCount} error(s) and ${report.warningCount} warning(s).`
        : report.warningCount > 0
          ? `Setup validation passed with ${report.warningCount} warning(s).`
          : 'Setup validation passed with no issues.';

    if (report.issues.length === 0) {
      return [status, `Guild ID: \`${report.guildId}\``];
    }

    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const warnings = report.issues.filter((issue) => issue.severity === 'warning');
    const remediationLines = this.formatSetupRemediationLines(errors);
    const issueLines = [
      ...(errors.length > 0
        ? ['Must fix before saving:', ...errors.map((issue) => `- [ERROR] ${issue.message}`)]
        : []),
      ...(warnings.length > 0
        ? ['Warnings:', ...warnings.map((issue) => `- [WARNING] ${issue.message}`)]
        : []),
      ...(remediationLines.length > 0
        ? ['', 'Recommended fix:', ...remediationLines.map((line) => `- ${line}`)]
        : errors.length > 0
          ? [
              '',
              'Next step:',
              '- Fix the listed Discord roles, channels, or permissions, then rerun `/config validate`.',
            ]
          : []),
    ];
    return [status, `Guild ID: \`${report.guildId}\``, ...issueLines];
  }

  private formatSetupRemediationLines(issues: readonly SetupDiagnosticIssue[]): readonly string[] {
    const codes = new Set(issues.map((issue) => issue.code));
    const lines = new Set<string>();

    if (
      this.hasAnySetupIssue(codes, [
        'case-role-missing',
        'case-role-not-found',
        'admin-channel-missing',
        'admin-channel-not-found',
        'verification-channel-missing',
        'verification-channel-not-found',
      ])
    ) {
      lines.add(
        'Run `/config setup admin-channel:<moderator-channel>` to repair core setup. Omit `case-role` and `verification-channel` to let Drasil reuse safe defaults or create them.'
      );
    }

    if (codes.has('verification-channel-create-manage-channels')) {
      lines.add(
        'Grant Drasil Manage Channels, or pass `verification-channel:<channel>` to use an existing text channel.'
      );
    }

    if (codes.has('case-role-hierarchy')) {
      lines.add('Move the Drasil bot role above the case role in Discord role settings.');
    }

    if (codes.has('case-role-managed') || codes.has('case-role-everyone')) {
      lines.add('Choose a normal assignable case role with `/config setup case-role:<role>`.');
    }

    if (
      [...codes].some((code) =>
        /-(view|send|embed-links|read-message-history|create-private-threads|send-messages-in-threads|manage-threads|sync-manage-channels)$/.test(
          code
        )
      )
    ) {
      lines.add('Grant the listed channel permission to Drasil, then rerun `/config validate`.');
    }

    return [...lines];
  }

  private hasAnySetupIssue(codes: ReadonlySet<string>, expectedCodes: readonly string[]): boolean {
    return expectedCodes.some((code) => codes.has(code));
  }

  private appendSetupDiagnosticsLines(lines: string[], report: SetupDiagnosticReport): void {
    lines.push('', ...this.buildSetupDiagnosticsLines(report));
  }

  private paginateLines(lines: readonly string[], maxLength = 1900): string[] {
    const pages: string[] = [];
    let current = '';

    for (const line of lines) {
      const segments =
        line.length > maxLength
          ? Array.from({ length: Math.ceil(line.length / maxLength) }, (_, index) =>
              line.slice(index * maxLength, (index + 1) * maxLength)
            )
          : [line];

      for (const segment of segments) {
        const candidate = current.length > 0 ? `${current}\n${segment}` : segment;
        if (candidate.length > maxLength && current.length > 0) {
          pages.push(current);
          current = segment;
        } else {
          current = candidate;
        }
      }
    }

    if (current.length > 0 || pages.length === 0) {
      pages.push(current);
    }
    return pages;
  }

  private async editReplyWithPages(
    interaction: ChatInputCommandInteraction,
    lines: readonly string[]
  ): Promise<void> {
    const [firstPage, ...additionalPages] = this.paginateLines(lines);
    await interaction.editReply({
      content: firstPage,
      allowedMentions: { parse: [] },
    });
    for (const content of additionalPages) {
      await interaction.followUp({
        content,
        allowedMentions: { parse: [] },
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
