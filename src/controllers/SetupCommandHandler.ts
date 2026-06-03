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
import { truncatePreview } from '../utils/textPreview';
import { ReportInstructionsManager } from './ReportInstructionsManager';

const DEFAULT_RESTRICTED_ROLE_NAME = 'Drasil Restricted';
const VERIFICATION_CHANNEL_NAME = 'verification';

type ReplyGuildInstallRequired = (interaction: ChatInputCommandInteraction) => Promise<void>;

export class SetupCommandHandler {
  public constructor(
    private readonly configService: IConfigService,
    private readonly notificationManager: INotificationManager,
    private readonly productAnalyticsService: IProductAnalyticsService,
    private readonly setupDiagnosticsService: ISetupDiagnosticsService | undefined,
    private readonly reportInstructionsManager: ReportInstructionsManager,
    private readonly replyGuildInstallRequired: ReplyGuildInstallRequired
  ) {}

  public async handleSetupVerificationCommand(
    interaction: ChatInputCommandInteraction
  ): Promise<void> {
    const guild = interaction.guild;
    if (!guild) {
      await this.replyGuildInstallRequired(interaction);
      return;
    }

    let hasAdminPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

    if (hasAdminPermission === undefined) {
      const invokingMember = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!invokingMember) {
        hasAdminPermission = false;
      } else if (interaction.channelId) {
        hasAdminPermission = invokingMember
          .permissionsIn(interaction.channelId)
          .has(PermissionFlagsBits.Administrator);
      } else {
        hasAdminPermission = invokingMember.permissions.has(PermissionFlagsBits.Administrator);
      }
    }

    if (!hasAdminPermission) {
      await interaction.reply({
        content: 'You need administrator permissions to set up the verification channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.setupDiagnosticsService) {
      await interaction.reply({
        content: 'Setup diagnostics are not available in this runtime.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let setupFailureDetail = 'Please check permissions and try again.';

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

      const candidateReport = await this.setupDiagnosticsService.validateSetupCandidate(guild, {
        restrictedRoleId: restrictedRole.id,
        willCreateRestrictedRole: false,
        adminChannelId: adminChannel.id,
        verificationChannelId: verificationChannelCandidate.channelId,
        willCreateVerificationChannel: !verificationChannelCandidate.channelId,
        ...(verificationChannelCandidate.willSyncPermissions
          ? { willSyncVerificationChannelPermissions: true }
          : {}),
        reportInstructionsChannelId: null,
      });

      if (candidateReport.errorCount > 0) {
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.\n\n${this.formatSetupDiagnosticsReport(candidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      let verificationChannelId = verificationChannel?.id ?? null;
      let verificationChannelAction: 'configured' | 'created' | 'synced' = verificationChannel
        ? 'configured'
        : 'created';
      const createdSetupArtifacts: { verificationChannelId?: string } = {};

      if (!verificationChannelId) {
        const onChannelCreated = (channelId: string): void => {
          createdSetupArtifacts.verificationChannelId = channelId;
        };
        const createdChannelId = verificationChannelCandidate.channelId
          ? await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated,
              verificationChannelCandidate.channelId
            )
          : await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated
            );
        if (!createdChannelId) {
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelId = createdChannelId;
        verificationChannelAction =
          verificationChannelCandidate.channelId && !createdSetupArtifacts.verificationChannelId
            ? 'synced'
            : 'created';
      }

      const finalCandidateReport = await this.setupDiagnosticsService.validateSetupCandidate(
        guild,
        {
          restrictedRoleId: restrictedRole.id,
          willCreateRestrictedRole: false,
          adminChannelId: adminChannel.id,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: null,
        }
      );
      if (finalCandidateReport.errorCount > 0) {
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId,
            'Rolling back Drasil setup after final validation failed'
          );
          setupFailureDetail = rolledBack
            ? 'Final validation failed. The newly created verification channel was removed.'
            : `Final validation failed. The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        const rollbackNote =
          setupFailureDetail !== 'Please check permissions and try again.'
            ? `\n\n${setupFailureDetail}`
            : '';
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(finalCandidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      try {
        await this.configService.updateServerConfig(guild.id, {
          restricted_role_id: restrictedRole.id,
          admin_channel_id: adminChannel.id,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId
          );
          setupFailureDetail = rolledBack
            ? 'Configuration could not be saved. The newly created verification channel was removed.'
            : `Configuration could not be saved. The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`;
        }
        throw error;
      }
      void this.productAnalyticsService.captureGuildEvent(
        guild.id,
        'verification setup completed',
        {
          verification_channel_created: verificationChannelAction === 'created',
          verification_channel_configured: Boolean(verificationChannelId),
          admin_channel_configured: true,
          restricted_role_configured: true,
        }
      );

      const verificationChannelMessage =
        verificationChannelAction === 'created'
          ? `Created verification channel: <#${verificationChannelId}>`
          : verificationChannelAction === 'synced'
            ? `Synced verification channel permissions: <#${verificationChannelId}>`
            : `Verification channel: <#${verificationChannelId}>`;

      const responseLines = [
        'Setup complete.',
        `Restricted role: <@&${restrictedRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        verificationChannelMessage,
      ];

      if (candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsReport(responseLines, candidateReport);
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
    if (!this.setupDiagnosticsService) {
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

    if (reportChannel && reportChannel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Report channel must be a text channel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (existingRestrictedRole && requestedRoleName) {
      await interaction.reply({
        content: '`restricted-role-name` cannot be combined with `restricted-role`.',
        flags: MessageFlags.Ephemeral,
      });
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

      if (restrictedRoleCandidate.ambiguousRoleIds.length > 0) {
        await interaction.editReply({
          content:
            `Setup not saved. Multiple roles named \`${restrictedRoleCandidate.roleName}\` already exist: ` +
            restrictedRoleCandidate.ambiguousRoleIds.map((roleId) => `<@&${roleId}>`).join(', ') +
            '. Choose one with `restricted-role` before rerunning /config setup.',
          allowedMentions: { parse: [] },
        });
        return;
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

      if (candidateReport.errorCount > 0) {
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.\n\n${this.formatSetupDiagnosticsReport(candidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      let createdRestrictedRole: Role | null = null;
      const createdSetupArtifacts: { verificationChannelId?: string } = {};
      let restrictedRole = restrictedRoleCandidate.role;
      if (!restrictedRole) {
        createdRestrictedRole = await guild.roles.create({
          name: restrictedRoleCandidate.roleName,
          permissions: [],
          reason: `Drasil setup requested by ${interaction.user.username}`,
        });
        restrictedRole = createdRestrictedRole;
      }

      const restrictedRoleWasCreated = Boolean(createdRestrictedRole);
      let verificationChannelId = verificationChannel?.id ?? null;
      let verificationChannelAction: 'configured' | 'created' | 'synced' = verificationChannel
        ? 'configured'
        : 'created';

      if (!verificationChannelId) {
        const onChannelCreated = (channelId: string): void => {
          createdSetupArtifacts.verificationChannelId = channelId;
        };
        verificationChannelId = verificationChannelCandidate.channelId
          ? await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated,
              verificationChannelCandidate.channelId
            )
          : await this.notificationManager.setupVerificationChannel(
              guild,
              restrictedRole.id,
              false,
              onChannelCreated
            );
        if (!verificationChannelId) {
          if (createdRestrictedRole) {
            const rolledBack = await this.rollbackCreatedRestrictedRole(
              createdRestrictedRole,
              guild.id
            );
            setupFailureDetail = rolledBack
              ? 'Verification channel setup failed. The newly created restricted role was removed.'
              : `Verification channel setup failed. The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`;
          }
          throw new Error('Failed to create a verification channel during setup.');
        }
        verificationChannelAction =
          verificationChannelCandidate.channelId && !createdSetupArtifacts.verificationChannelId
            ? 'synced'
            : 'created';
      }

      const finalCandidateReport = await this.setupDiagnosticsService.validateSetupCandidate(
        guild,
        {
          restrictedRoleId: restrictedRole.id,
          willCreateRestrictedRole: false,
          adminChannelId: adminChannel.id,
          verificationChannelId,
          willCreateVerificationChannel: false,
          reportInstructionsChannelId: reportChannel?.id ?? null,
        }
      );
      if (finalCandidateReport.errorCount > 0) {
        const rollbackDetails = ['Final validation failed.'];
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;
        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId,
            'Rolling back Drasil setup after final validation failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created verification channel was removed.'
              : `The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`
          );
        }
        if (createdRestrictedRole) {
          const rolledBack = await this.rollbackCreatedRestrictedRole(
            createdRestrictedRole,
            guild.id,
            'Rolling back Drasil setup after final validation failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created restricted role was removed.'
              : `The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`
          );
        }
        setupFailureDetail = rollbackDetails.join(' ');
        const rollbackNote = `\n\n${setupFailureDetail}`;
        await interaction.editReply({
          content: `Setup not saved. Fix the errors below and rerun /config setup.${rollbackNote}\n\n${this.formatSetupDiagnosticsReport(finalCandidateReport)}`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      try {
        await this.configService.updateServerConfig(guild.id, {
          restricted_role_id: restrictedRole.id,
          admin_channel_id: adminChannel.id,
          verification_channel_id: verificationChannelId,
        });
      } catch (error) {
        const rollbackDetails = ['Configuration could not be saved.'];
        const createdVerificationChannelId = createdSetupArtifacts.verificationChannelId;

        if (createdVerificationChannelId) {
          const rolledBack = await this.rollbackCreatedVerificationChannel(
            guild,
            createdVerificationChannelId
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created verification channel was removed.'
              : `The newly created verification channel <#${createdVerificationChannelId}> could not be removed; delete it before rerunning setup.`
          );
        }

        if (createdRestrictedRole) {
          const rolledBack = await this.rollbackCreatedRestrictedRole(
            createdRestrictedRole,
            guild.id,
            'Rolling back Drasil setup after config save failed'
          );
          rollbackDetails.push(
            rolledBack
              ? 'The newly created restricted role was removed.'
              : `The newly created restricted role <@&${restrictedRole.id}> could not be removed; delete it or pass it as restricted-role when rerunning setup.`
          );
        }

        setupFailureDetail = rollbackDetails.join(' ');
        throw error;
      }

      let reportInstructionsLine: string | null = null;
      let reportInstructionsWarningLine: string | null = null;
      if (reportChannel) {
        try {
          const result = await this.reportInstructionsManager.upsertReportInstructionsMessage(
            guild.id,
            reportChannel as TextChannel
          );
          reportInstructionsLine = `Report instructions ${result.action}: <#${reportChannel.id}>`;
        } catch (error) {
          console.error(`Failed to upsert report instructions for guild ${guild.id}:`, error);
          reportInstructionsWarningLine =
            `[WARNING] Core setup was saved, but report instructions were not updated in <#${reportChannel.id}>. ` +
            'Check Drasil can send messages and embeds there, then rerun setup.';
        }
      }

      const lines = [
        'Setup complete.',
        `${restrictedRoleWasCreated ? 'Created restricted role' : 'Restricted role'}: <@&${restrictedRole.id}>`,
        `Admin channel: <#${adminChannel.id}>`,
        `${verificationChannelAction === 'created' ? 'Created verification channel' : verificationChannelAction === 'synced' ? 'Synced verification channel permissions' : 'Verification channel'}: <#${verificationChannelId}>`,
      ];

      if (reportInstructionsLine) {
        lines.push(reportInstructionsLine);
      }

      if (reportInstructionsWarningLine) {
        lines.push(reportInstructionsWarningLine);
      }

      if (candidateReport.warningCount > 0) {
        this.appendSetupDiagnosticsReport(lines, candidateReport);
      }

      await interaction.editReply({
        content: truncatePreview(lines.join('\n'), 1900),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      console.error(`Failed to complete config setup for guild ${guild.id}:`, error);
      await interaction.editReply({
        content: setupFailureDetail
          ? `Failed to complete setup. ${setupFailureDetail}`
          : 'Failed to complete setup. Please check permissions and try again.',
        allowedMentions: { parse: [] },
      });
    }
  }

  private async rollbackCreatedRestrictedRole(
    role: Role,
    guildId: string,
    reason = 'Rolling back Drasil setup after verification channel setup failed'
  ): Promise<boolean> {
    try {
      await role.delete(reason);
      return true;
    } catch (error) {
      console.error(`Failed to roll back restricted role ${role.id} for guild ${guildId}:`, error);
      return false;
    }
  }

  private async rollbackCreatedVerificationChannel(
    guild: NonNullable<ChatInputCommandInteraction['guild']>,
    channelId: string,
    reason = 'Rolling back Drasil setup after config save failed'
  ): Promise<boolean> {
    try {
      const channel =
        guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId));
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.error(
          `Could not find text verification channel ${channelId} to roll back for guild ${guild.id}`
        );
        return false;
      }

      await channel.delete(reason);
      return true;
    } catch (error) {
      console.error(
        `Failed to roll back verification channel ${channelId} for guild ${guild.id}:`,
        error
      );
      return false;
    }
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
