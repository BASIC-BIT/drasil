import { ChannelType, Guild, GuildMember, PermissionFlagsBits, TextChannel } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { Server } from '../repositories/types';
import { TYPES } from '../di/symbols';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';

export type SetupDiagnosticSeverity = 'error' | 'warning';

export interface SetupDiagnosticIssue {
  readonly severity: SetupDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
}

export interface SetupDiagnosticReport {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly issues: readonly SetupDiagnosticIssue[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface SetupCandidate {
  readonly restrictedRoleId?: string | null;
  readonly willCreateRestrictedRole?: boolean;
  readonly adminChannelId: string | null;
  readonly verificationChannelId?: string | null;
  readonly willCreateVerificationChannel?: boolean;
  readonly reportInstructionsChannelId?: string | null;
}

export interface ISetupDiagnosticsService {
  validateGuildSetup(guild: Guild): Promise<SetupDiagnosticReport>;
  validateSetupCandidate(guild: Guild, candidate: SetupCandidate): Promise<SetupDiagnosticReport>;
}

interface PermissionRequirement {
  readonly permission: bigint;
  readonly label: string;
  readonly severity: SetupDiagnosticSeverity;
  readonly codeSuffix: string;
}

const ADMIN_CHANNEL_PERMISSIONS: readonly PermissionRequirement[] = [
  {
    permission: PermissionFlagsBits.ViewChannel,
    label: 'View Channel',
    severity: 'error',
    codeSuffix: 'view',
  },
  {
    permission: PermissionFlagsBits.SendMessages,
    label: 'Send Messages',
    severity: 'error',
    codeSuffix: 'send',
  },
  {
    permission: PermissionFlagsBits.EmbedLinks,
    label: 'Embed Links',
    severity: 'error',
    codeSuffix: 'embed-links',
  },
];

const VERIFICATION_CHANNEL_PERMISSIONS: readonly PermissionRequirement[] = [
  ...ADMIN_CHANNEL_PERMISSIONS,
  {
    permission: PermissionFlagsBits.CreatePrivateThreads,
    label: 'Create Private Threads',
    severity: 'error',
    codeSuffix: 'create-private-threads',
  },
  {
    permission: PermissionFlagsBits.SendMessagesInThreads,
    label: 'Send Messages in Threads',
    severity: 'error',
    codeSuffix: 'send-messages-in-threads',
  },
  {
    permission: PermissionFlagsBits.ManageThreads,
    label: 'Manage Threads',
    severity: 'warning',
    codeSuffix: 'manage-threads',
  },
];

@injectable()
export class SetupDiagnosticsService implements ISetupDiagnosticsService {
  constructor(@inject(TYPES.ConfigService) private readonly configService: IConfigService) {}

  public async validateGuildSetup(guild: Guild): Promise<SetupDiagnosticReport> {
    const issues: SetupDiagnosticIssue[] = [];
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const botMember = await this.getBotMember(guild);

    if (!botMember) {
      issues.push({
        severity: 'error',
        code: 'bot-member-missing',
        message: 'Could not load Drasil as a server member, so permissions cannot be checked.',
      });
      return this.toReport(guild.id, issues);
    }

    this.checkGuildPermissions(botMember, issues);
    await this.checkRestrictedRole(guild, botMember, serverConfig, issues);
    await this.checkConfiguredTextChannel(
      guild,
      botMember,
      serverConfig.admin_channel_id,
      'admin-channel',
      'Admin notification channel',
      ADMIN_CHANNEL_PERMISSIONS,
      issues
    );
    await this.checkConfiguredTextChannel(
      guild,
      botMember,
      serverConfig.verification_channel_id,
      'verification-channel',
      'Verification channel',
      VERIFICATION_CHANNEL_PERMISSIONS,
      issues
    );

    const detectionSettings = getDetectionResponseSettings(serverConfig.settings);
    if (detectionSettings.observedNotificationChannelId) {
      await this.checkConfiguredTextChannel(
        guild,
        botMember,
        detectionSettings.observedNotificationChannelId,
        'observed-notification-channel',
        'Observed detection notification channel',
        ADMIN_CHANNEL_PERMISSIONS,
        issues
      );
    }

    if (serverConfig.settings.report_instructions_channel_id) {
      await this.checkConfiguredTextChannel(
        guild,
        botMember,
        serverConfig.settings.report_instructions_channel_id,
        'report-instructions-channel',
        'Report instructions channel',
        ADMIN_CHANNEL_PERMISSIONS,
        issues
      );
    }

    return this.toReport(guild.id, issues);
  }

  public async validateSetupCandidate(
    guild: Guild,
    candidate: SetupCandidate
  ): Promise<SetupDiagnosticReport> {
    const issues: SetupDiagnosticIssue[] = [];
    const botMember = await this.getBotMember(guild);

    if (!botMember) {
      issues.push({
        severity: 'error',
        code: 'bot-member-missing',
        message: 'Could not load Drasil as a server member, so permissions cannot be checked.',
      });
      return this.toReport(guild.id, issues);
    }

    this.checkGuildPermissions(botMember, issues);
    await this.checkRestrictedRoleCandidate(guild, botMember, candidate, issues);
    await this.checkConfiguredTextChannel(
      guild,
      botMember,
      candidate.adminChannelId,
      'admin-channel',
      'Admin notification channel',
      ADMIN_CHANNEL_PERMISSIONS,
      issues
    );
    await this.checkVerificationChannelCandidate(guild, botMember, candidate, issues);

    if (candidate.reportInstructionsChannelId) {
      await this.checkConfiguredTextChannel(
        guild,
        botMember,
        candidate.reportInstructionsChannelId,
        'report-instructions-channel',
        'Report instructions channel',
        ADMIN_CHANNEL_PERMISSIONS,
        issues
      );
    }

    return this.toReport(guild.id, issues);
  }

  private async getBotMember(guild: Guild): Promise<GuildMember | null> {
    if (guild.members.me) {
      return guild.members.me;
    }

    return guild.members.fetchMe().catch(() => null);
  }

  private checkGuildPermissions(botMember: GuildMember, issues: SetupDiagnosticIssue[]): void {
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      issues.push({
        severity: 'error',
        code: 'guild-manage-roles',
        message: 'Drasil is missing Manage Roles, so it cannot apply the restricted role.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      issues.push({
        severity: 'warning',
        code: 'guild-ban-members',
        message: 'Drasil is missing Ban Members, so moderator ban actions will fail.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      issues.push({
        severity: 'warning',
        code: 'guild-view-audit-log',
        message:
          'Drasil is missing View Audit Log, so installer attribution and setup nudges are best-effort only.',
      });
    }

    if (botMember.permissions.has(PermissionFlagsBits.Administrator)) {
      issues.push({
        severity: 'warning',
        code: 'guild-administrator',
        message:
          'Drasil has Administrator. Prefer the documented specific permissions once setup is complete.',
      });
    }
  }

  private async checkRestrictedRole(
    guild: Guild,
    botMember: GuildMember,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    await this.checkRestrictedRoleId(guild, botMember, serverConfig.restricted_role_id, issues);
  }

  private async checkRestrictedRoleCandidate(
    guild: Guild,
    botMember: GuildMember,
    candidate: SetupCandidate,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (candidate.restrictedRoleId) {
      await this.checkRestrictedRoleId(guild, botMember, candidate.restrictedRoleId, issues);
      return;
    }

    if (candidate.willCreateRestrictedRole) {
      return;
    }

    issues.push({
      severity: 'error',
      code: 'restricted-role-missing',
      message: 'Restricted role is not configured.',
    });
  }

  private async checkRestrictedRoleId(
    guild: Guild,
    botMember: GuildMember,
    restrictedRoleId: string | null | undefined,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (!restrictedRoleId) {
      issues.push({
        severity: 'error',
        code: 'restricted-role-missing',
        message: 'Restricted role is not configured.',
      });
      return;
    }

    const restrictedRole = await guild.roles.fetch(restrictedRoleId).catch(() => null);
    if (!restrictedRole) {
      issues.push({
        severity: 'error',
        code: 'restricted-role-not-found',
        message: `Restricted role ${restrictedRoleId} no longer exists.`,
      });
      return;
    }

    if (restrictedRole.id === guild.id) {
      issues.push({
        severity: 'error',
        code: 'restricted-role-everyone',
        message: 'Restricted role cannot be @everyone.',
      });
    }

    if (restrictedRole.managed) {
      issues.push({
        severity: 'error',
        code: 'restricted-role-managed',
        message: `Restricted role <@&${restrictedRole.id}> is managed by an integration and cannot be assigned by Drasil.`,
      });
    }

    if (botMember.roles.highest.comparePositionTo(restrictedRole) <= 0) {
      issues.push({
        severity: 'error',
        code: 'restricted-role-hierarchy',
        message: `Drasil's highest role must be above restricted role <@&${restrictedRole.id}>.`,
      });
    }
  }

  private async checkVerificationChannelCandidate(
    guild: Guild,
    botMember: GuildMember,
    candidate: SetupCandidate,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (candidate.verificationChannelId) {
      await this.checkConfiguredTextChannel(
        guild,
        botMember,
        candidate.verificationChannelId,
        'verification-channel',
        'Verification channel',
        VERIFICATION_CHANNEL_PERMISSIONS,
        issues
      );
      return;
    }

    if (!candidate.willCreateVerificationChannel) {
      issues.push({
        severity: 'error',
        code: 'verification-channel-missing',
        message: 'Verification channel is not configured.',
      });
      return;
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      issues.push({
        severity: 'error',
        code: 'verification-channel-create-manage-channels',
        message:
          'Drasil is missing Manage Channels, so it cannot create the verification channel automatically.',
      });
    }
  }

  private async checkConfiguredTextChannel(
    guild: Guild,
    botMember: GuildMember,
    channelId: string | null | undefined,
    codePrefix: string,
    label: string,
    requirements: readonly PermissionRequirement[],
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (!channelId) {
      issues.push({
        severity: 'error',
        code: `${codePrefix}-missing`,
        message: `${label} is not configured.`,
      });
      return;
    }

    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
      issues.push({
        severity: 'error',
        code: `${codePrefix}-not-found`,
        message: `${label} ${channelId} no longer exists or is not a text channel.`,
      });
      return;
    }

    const textChannel = channel as TextChannel;
    const permissions = textChannel.permissionsFor(botMember);

    for (const requirement of requirements) {
      if (!permissions.has(requirement.permission)) {
        issues.push({
          severity: requirement.severity,
          code: `${codePrefix}-${requirement.codeSuffix}`,
          message: `Drasil is missing ${requirement.label} in ${label} <#${textChannel.id}>.`,
        });
      }
    }
  }

  private toReport(
    guildId: string,
    issues: readonly SetupDiagnosticIssue[]
  ): SetupDiagnosticReport {
    const errorCount = issues.filter((issue) => issue.severity === 'error').length;
    const warningCount = issues.filter((issue) => issue.severity === 'warning').length;
    return {
      guildId,
      checkedAt: new Date(),
      issues,
      errorCount,
      warningCount,
    };
  }
}
