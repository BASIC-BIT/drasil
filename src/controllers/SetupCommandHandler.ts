import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  Role,
  TextChannel,
} from 'discord.js';
import { IConfigService } from '../config/ConfigService';
import { INotificationManager } from '../services/NotificationManager';
import { IProductAnalyticsService } from '../services/ProductAnalyticsService';
import {
  ISetupDiagnosticsService,
  SetupDiagnosticIssue,
  SetupDiagnosticReport,
} from '../services/SetupDiagnosticsService';
import { SetupWorkflowService, type SetupWorkflowResult } from '../services/SetupWorkflowService';
import { truncatePreview } from '../utils/textPreview';
import { ReportInstructionsManager } from './ReportInstructionsManager';

const DEFAULT_RESTRICTED_ROLE_NAME = 'Drasil Restricted';
const DEFAULT_SETUP_FAILURE_DETAIL = 'Please check permissions and try again.';
const VERIFICATION_CHANNEL_NAME = 'verification';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;
type CompletedSetupWorkflowResult = Extract<SetupWorkflowResult, { status: 'completed' }>;
type ConfigSetupReportInstructionsStatus = {
  line: string | null;
  warningLine: string | null;
};

export class SetupCommandHandler {
  private readonly setupWorkflowService?: SetupWorkflowService;

  public constructor(
    private readonly configService: IConfigService,
    notificationManager: INotificationManager,
    productAnalyticsService: IProductAnalyticsService,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService | undefined,
    private readonly reportInstructionsManager: ReportInstructionsManager,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {
    this.setupWorkflowService = setupDiagnosticsService
      ? new SetupWorkflowService(
          configService,
          notificationManager,
          productAnalyticsService,
          setupDiagnosticsService
        )
      : undefined;
  }

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

    const setupWorkflowService = this.setupWorkflowService;
    if (!this.setupDiagnosticsService || !setupWorkflowService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = DEFAULT_SETUP_FAILURE_DETAIL;

    try {
      const restrictedRole = interaction.options.getRole('restricted-role', true);
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

      const verificationChannelCandidate = await this.resolveVerificationChannelCandidate(
        guild,
        verificationChannel?.id ?? null
      );

      if (verificationChannelCandidate.ambiguousChannelIds.length > 0) {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple #${VERIFICATION_CHANNEL_NAME} channels already exist: ` +
            verificationChannelCandidate.ambiguousChannelIds
              .map((channelId) => `<#${channelId}>`)
              .join(', ') +
            '. Choose one with `verification-channel` before rerunning setup.',
          allowedMentions: { parse: [] },
        });
        return;
      }

      const setupResult = await setupWorkflowService.completeSetup({
        guild,
        restrictedRole: restrictedRole as Role,
        adminChannelId: adminChannel.id,
        initialVerificationChannelId: verificationChannel?.id ?? null,
        candidateVerificationChannelId: verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: null,
        captureAnalytics: true,
      });

      if (setupResult.status === 'candidate_validation_failed') {
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.\n\n${this.formatSetupDiagnosticsReport(setupResult.report)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (setupResult.status === 'final_validation_failed') {
        setupFailureDetail = setupResult.setupFailureDetail;
        const rollbackNote =
          setupFailureDetail !== DEFAULT_SETUP_FAILURE_DETAIL ? `\n\n${setupFailureDetail}` : '';
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(setupResult.report)}`,
          allowedMentions: { parse: [] },
        });
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
        `Restricted role: <@&${restrictedRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        verificationChannelMessage,
      ];

      if (setupResult.candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsReport(responseLines, setupResult.candidateReport);
      }

      await interaction.editReply({
        content: truncatePreview(responseLines.join('\n'), 1900),
        allowedMentions: { parse: [] },
      });
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

  private async resolveVerificationChannelCandidate(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    explicitVerificationChannelId: string | null
  ): Promise<{
    channelId: string | null;
    willSyncPermissions: boolean;
    ambiguousChannelIds: readonly string[];
  }> {
    if (explicitVerificationChannelId) {
      return {
        channelId: explicitVerificationChannelId,
        willSyncPermissions: false,
        ambiguousChannelIds: [],
      };
    }

    const serverConfig = await this.configService.getServerConfig(guild.id).catch(() => null);
    const configuredVerificationChannelId = serverConfig?.verification_channel_id ?? null;
    if (configuredVerificationChannelId) {
      const configuredChannel = await guild.channels
        .fetch(configuredVerificationChannelId)
        .catch(() => null);
      if (configuredChannel?.type === ChannelType.GuildText) {
        return {
          channelId: configuredVerificationChannelId,
          willSyncPermissions: true,
          ambiguousChannelIds: [],
        };
      }
    }

    const matchingChannels = this.findMatchingVerificationChannels(guild);
    if (matchingChannels.length === 1) {
      return {
        channelId: matchingChannels[0].id,
        willSyncPermissions: true,
        ambiguousChannelIds: [],
      };
    }

    return {
      channelId: null,
      willSyncPermissions: false,
      ambiguousChannelIds: matchingChannels.map((channel) => channel.id),
    };
  }

  private findMatchingVerificationChannels(
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): TextChannel[] {
    const guildLike = guild as { channels?: { cache?: unknown } };
    const values = this.getCachedCollectionValues(guildLike.channels?.cache);

    return values.filter((channel): channel is TextChannel =>
      this.isVerificationTextChannel(channel)
    );
  }

  private getCachedCollectionValues(cache: unknown): unknown[] {
    const cacheWithValues = cache as { values?: unknown } | null;
    if (typeof cacheWithValues?.values === 'function') {
      return [...(cacheWithValues.values as () => Iterable<unknown>)()];
    }

    const iterableCache = cache as { [Symbol.iterator]?: unknown } | null;
    if (typeof iterableCache?.[Symbol.iterator] === 'function') {
      return [...(cache as Iterable<unknown>)];
    }

    return [];
  }

  private isVerificationTextChannel(channel: unknown): channel is TextChannel {
    const maybeChannel = channel as { type?: ChannelType; name?: string } | null;
    if (!maybeChannel) {
      return false;
    }

    return (
      maybeChannel.type === ChannelType.GuildText && maybeChannel.name === VERIFICATION_CHANNEL_NAME
    );
  }

  private async resolveRestrictedRoleCandidate(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    explicitRestrictedRole: Role | null,
    requestedRoleName: string | null
  ): Promise<{ role: Role | null; roleName: string; ambiguousRoleIds: readonly string[] }> {
    if (explicitRestrictedRole) {
      return {
        role: explicitRestrictedRole,
        roleName: explicitRestrictedRole.name,
        ambiguousRoleIds: [],
      };
    }

    const roleName = requestedRoleName ?? DEFAULT_RESTRICTED_ROLE_NAME;
    const serverConfig = await this.configService.getServerConfig(guild.id).catch(() => null);
    const configuredRestrictedRoleId = serverConfig?.restricted_role_id ?? null;
    if (configuredRestrictedRoleId) {
      const configuredRole = await guild.roles.fetch(configuredRestrictedRoleId).catch(() => null);
      if (configuredRole && (!requestedRoleName || configuredRole.name === roleName)) {
        return { role: configuredRole, roleName: configuredRole.name, ambiguousRoleIds: [] };
      }
    }

    const matchingRoles = this.findMatchingRolesByName(guild, roleName);
    if (matchingRoles.length === 1) {
      return { role: matchingRoles[0], roleName, ambiguousRoleIds: [] };
    }

    return {
      role: null,
      roleName,
      ambiguousRoleIds: matchingRoles.map((role) => role.id),
    };
  }

  private findMatchingRolesByName(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    roleName: string
  ): Role[] {
    const guildLike = guild as { roles?: { cache?: unknown } };
    const values = this.getCachedCollectionValues(guildLike.roles?.cache);

    return values.filter((role): role is Role => this.isRoleNamed(role, roleName));
  }

  private isRoleNamed(role: unknown, roleName: string): role is Role {
    const maybeRole = role as { name?: string } | null;
    return Boolean(maybeRole) && maybeRole?.name === roleName;
  }

  public async handleConfigSetupCommand(
    interaction: ChatInputCommandInteraction,
    guild: NonNullable<ChatInputCommandInteraction['guild']>
  ): Promise<void> {
    const setupWorkflowService = this.setupWorkflowService;
    if (!this.setupDiagnosticsService || !setupWorkflowService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const adminChannel = interaction.options.getChannel('admin-channel', true);
    const existingRestrictedRole = interaction.options.getRole('restricted-role');
    const requestedRoleName = interaction.options.getString('restricted-role-name')?.trim() || null;
    const verificationChannel = interaction.options.getChannel('verification-channel');
    const reportChannel = interaction.options.getChannel('report-channel');

    if (
      await this.replyIfInvalidConfigSetupOptions(interaction, {
        adminChannel,
        verificationChannel,
        reportChannel,
        hasExplicitRestrictedRole: Boolean(existingRestrictedRole),
        requestedRoleName,
      })
    ) {
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let setupFailureDetail: string | null = null;

    try {
      const verificationChannelCandidate = await this.resolveVerificationChannelCandidate(
        guild,
        verificationChannel?.id ?? null
      );
      const restrictedRoleCandidate = await this.resolveRestrictedRoleCandidate(
        guild,
        existingRestrictedRole as Role | null,
        requestedRoleName
      );

      if (
        await this.replyIfAmbiguousConfigSetupCandidates(
          interaction,
          restrictedRoleCandidate,
          verificationChannelCandidate
        )
      ) {
        return;
      }

      const candidateReport = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
        restrictedRoleId: restrictedRoleCandidate.role?.id ?? null,
        willCreateRestrictedRole: !restrictedRoleCandidate.role,
        adminChannelId: adminChannel.id,
        verificationChannelId: verificationChannelCandidate.channelId,
        willCreateVerificationChannel: !verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: reportChannel?.id ?? null,
      });

      if (await this.replyIfConfigSetupCandidateHasErrors(interaction, candidateReport)) {
        return;
      }

      let createdRestrictedRole: Role | null = null;
      let restrictedRole = restrictedRoleCandidate.role;
      if (!restrictedRole) {
        createdRestrictedRole = await guild.roles.create({
          name: restrictedRoleCandidate.roleName,
          permissions: [],
          reason: `Drasil setup requested by ${interaction.user.username}`,
        });
        restrictedRole = createdRestrictedRole;
      }

      const setupResult = await setupWorkflowService.completeSetup({
        guild,
        restrictedRole,
        adminChannelId: adminChannel.id,
        initialVerificationChannelId: verificationChannel?.id ?? null,
        candidateVerificationChannelId: verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: reportChannel?.id ?? null,
        candidateReport,
        createdRestrictedRole,
      });

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

      const reportInstructionsStatus = await this.upsertReportInstructionsStatus(
        guild.id,
        reportChannel as TextChannel | null
      );
      const lines = this.buildConfigSetupSuccessLines(
        setupResult,
        adminChannel.id,
        reportInstructionsStatus
      );

      await interaction.editReply({
        content: truncatePreview(lines.join('\n'), 1900),
        allowedMentions: { parse: [] },
      });
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
      hasExplicitRestrictedRole: boolean;
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

    if (options.hasExplicitRestrictedRole && options.requestedRoleName) {
      await interaction.reply({
        content: '`restricted-role-name` cannot be combined with `restricted-role`.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  }

  private async replyIfAmbiguousConfigSetupCandidates(
    interaction: ChatInputCommandInteraction,
    restrictedRoleCandidate: { roleName: string; ambiguousRoleIds: readonly string[] },
    verificationChannelCandidate: { ambiguousChannelIds: readonly string[] }
  ): Promise<boolean> {
    if (restrictedRoleCandidate.ambiguousRoleIds.length > 0) {
      await interaction.editReply({
        content:
          `Setup not saved. Multiple roles named \`${restrictedRoleCandidate.roleName}\` already exist: ` +
          restrictedRoleCandidate.ambiguousRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') +
          '. Choose one with `restricted-role` before rerunning /config setup.',
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (verificationChannelCandidate.ambiguousChannelIds.length > 0) {
      await interaction.editReply({
        content:
          `Setup not saved. Multiple #${VERIFICATION_CHANNEL_NAME} channels already exist: ` +
          verificationChannelCandidate.ambiguousChannelIds
            .map((channelId) => `<#${channelId}>`)
            .join(', ') +
          '. Choose one with `verification-channel` before rerunning /config setup.',
        allowedMentions: { parse: [] },
      });
      return true;
    }

    return false;
  }

  private async replyIfConfigSetupCandidateHasErrors(
    interaction: ChatInputCommandInteraction,
    candidateReport: SetupDiagnosticReport
  ): Promise<boolean> {
    if (candidateReport.errorCount === 0) {
      return false;
    }

    await interaction.editReply({
      content: `Setup not saved. Fix the errors below and rerun /config setup.\n\n${this.formatSetupDiagnosticsReport(candidateReport)}`,
      allowedMentions: { parse: [] },
    });
    return true;
  }

  private async resolveIncompleteConfigSetupResult(
    interaction: ChatInputCommandInteraction,
    setupResult: Exclude<SetupWorkflowResult, { status: 'completed' }>
  ): Promise<{ setupFailureDetail: string | null; error?: unknown }> {
    switch (setupResult.status) {
      case 'candidate_validation_failed':
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.\n\n${this.formatSetupDiagnosticsReport(setupResult.report)}`,
          allowedMentions: { parse: [] },
        });
        return { setupFailureDetail: null };
      case 'final_validation_failed': {
        const rollbackNote =
          setupResult.setupFailureDetail !== DEFAULT_SETUP_FAILURE_DETAIL
            ? `\n\n${setupResult.setupFailureDetail}`
            : '';
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(setupResult.report)}`,
          allowedMentions: { parse: [] },
        });
        return { setupFailureDetail: setupResult.setupFailureDetail };
      }
      case 'verification_channel_failed':
      case 'config_save_failed':
        return { setupFailureDetail: setupResult.setupFailureDetail, error: setupResult.error };
    }
  }

  private async upsertReportInstructionsStatus(
    guildId: string,
    reportChannel: TextChannel | null
  ): Promise<ConfigSetupReportInstructionsStatus> {
    if (!reportChannel) {
      return { line: null, warningLine: null };
    }

    try {
      const result = await this.reportInstructionsManager.upsertReportInstructionsMessage(
        guildId,
        reportChannel
      );
      return {
        line: `Report instructions ${result.action}: <#${reportChannel.id}>`,
        warningLine: null,
      };
    } catch (error) {
      console.error(`Failed to upsert report instructions for guild ${guildId}:`, error);
      return {
        line: null,
        warningLine:
          `[WARNING] Core setup was saved, but report instructions were not updated in <#${reportChannel.id}>. ` +
          'Check Drasil can send messages and embeds there, then rerun setup.',
      };
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
      `${setupResult.restrictedRoleWasCreated ? 'Created restricted role' : 'Restricted role'}: <@&${setupResult.restrictedRoleId}>`,
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
      this.appendSetupDiagnosticsReport(lines, setupResult.candidateReport);
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
      await interaction.editReply({
        content: this.formatSetupDiagnosticsReport(report),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to validate setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: 'Failed to validate setup. Please try again later.',
      });
    }
  }

  private formatSetupDiagnosticsReport(report: SetupDiagnosticReport, maxLength = 1900): string {
    const status =
      report.errorCount > 0
        ? `Setup validation failed with ${report.errorCount} error(s) and ${report.warningCount} warning(s).`
        : report.warningCount > 0
          ? `Setup validation passed with ${report.warningCount} warning(s).`
          : 'Setup validation passed with no issues.';

    if (report.issues.length === 0) {
      return `${status}\nGuild ID: \`${report.guildId}\``;
    }

    const errors = report.issues.filter((issue) => issue.severity === 'error');
    const warnings = report.issues.filter((issue) => issue.severity === 'warning');
    const remediationLines = this.formatSetupRemediationLines(errors);
    const issueLines = [
      ...(errors.length > 0
        ? ['Must fix before saving:', ...errors.map((issue) => `- [ERROR] ${issue.message}`)]
        : []),
      ...(warnings.length > 0
        ? ['Saved but warnings:', ...warnings.map((issue) => `- [WARNING] ${issue.message}`)]
        : []),
      ...(remediationLines.length > 0
        ? ['', 'Recommended fix:', ...remediationLines.map((line) => `- ${line}`)]
        : [
            '',
            'Next step:',
            '- Fix the listed Discord roles, channels, or permissions, then rerun `/config validate`.',
          ]),
    ];
    return truncatePreview(
      [status, `Guild ID: \`${report.guildId}\``, ...issueLines].join('\n'),
      maxLength
    );
  }

  private formatSetupRemediationLines(issues: readonly SetupDiagnosticIssue[]): readonly string[] {
    const codes = new Set(issues.map((issue) => issue.code));
    const lines = new Set<string>();

    if (
      this.hasAnySetupIssue(codes, [
        'restricted-role-missing',
        'restricted-role-not-found',
        'admin-channel-missing',
        'admin-channel-not-found',
        'verification-channel-missing',
        'verification-channel-not-found',
      ])
    ) {
      lines.add(
        'Run `/config setup admin-channel:<moderator-channel>` to repair core setup. Omit `restricted-role` and `verification-channel` to let Drasil reuse safe defaults or create them.'
      );
    }

    if (codes.has('verification-channel-create-manage-channels')) {
      lines.add(
        'Grant Drasil Manage Channels, or pass `verification-channel:<channel>` to use an existing text channel.'
      );
    }

    if (codes.has('restricted-role-hierarchy')) {
      lines.add('Move the Drasil bot role above the restricted role in Discord role settings.');
    }

    if (codes.has('restricted-role-managed') || codes.has('restricted-role-everyone')) {
      lines.add(
        'Choose a normal assignable restricted role with `/config setup restricted-role:<role>`.'
      );
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

  private appendSetupDiagnosticsReport(
    lines: string[],
    report: SetupDiagnosticReport,
    maxLength = 1900
  ): void {
    const prefix = lines.join('\n');
    const separatorLength = prefix.length > 0 ? 2 : 0;
    const budget = Math.max(200, maxLength - prefix.length - separatorLength);
    lines.push('', this.formatSetupDiagnosticsReport(report, budget));
  }
}
