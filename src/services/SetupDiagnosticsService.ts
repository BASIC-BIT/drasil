import { ChannelType, Guild, GuildMember, PermissionFlagsBits, TextChannel } from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { Server } from '../repositories/types';
import { TYPES } from '../di/symbols';
import { getDetectionResponseSettings } from '../utils/detectionResponseSettings';
import { getCaseResponderSettings } from '../utils/caseResponderSettings';
import { getManualIntakeSettings } from '../utils/manualIntakeSettings';
import { getRoleGateSettings } from '../utils/roleGateSettings';

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
  readonly caseRoleId?: string | null;
  readonly willCreateCaseRole?: boolean;
  readonly adminChannelId: string | null;
  readonly verificationChannelId?: string | null;
  readonly willCreateVerificationChannel?: boolean;
  readonly willSyncVerificationChannelPermissions?: boolean;
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
    permission: PermissionFlagsBits.ReadMessageHistory,
    label: 'Read Message History',
    severity: 'error',
    codeSuffix: 'read-message-history',
  },
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

const VERIFICATION_CHANNEL_SYNC_PERMISSIONS: readonly PermissionRequirement[] = [
  {
    permission: PermissionFlagsBits.ManageChannels,
    label: 'Manage Channels',
    severity: 'error',
    codeSuffix: 'sync-manage-channels',
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
    await this.checkCaseRole(guild, botMember, serverConfig, issues);
    await this.checkConfiguredTextChannel(
      guild,
      botMember,
      serverConfig.admin_channel_id,
      'admin-channel',
      'Admin notification channel',
      ADMIN_CHANNEL_PERMISSIONS,
      issues
    );
    await this.checkAdminNotificationRole(guild, botMember, serverConfig, issues);
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
        VERIFICATION_CHANNEL_PERMISSIONS,
        issues
      );
    }

    await this.checkCaseResponderRoles(guild, serverConfig, issues);
    await this.checkManualIntakeRole(guild, serverConfig, issues);
    await this.checkRoleGateRoles(guild, botMember, serverConfig, issues);

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
    await this.checkCaseRoleCandidate(guild, botMember, candidate, issues);
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
        VERIFICATION_CHANNEL_PERMISSIONS,
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
        message: 'Drasil is missing Manage Roles, so it cannot apply the case role.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) {
      issues.push({
        severity: 'warning',
        code: 'guild-ban-members',
        message: 'Drasil is missing Ban Members, so moderator ban actions will fail.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) {
      issues.push({
        severity: 'warning',
        code: 'guild-kick-members',
        message: 'Drasil is missing Kick Members, so moderator kick actions will fail.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageMessages)) {
      issues.push({
        severity: 'warning',
        code: 'guild-manage-messages',
        message:
          'Drasil is missing Manage Messages, so configured message deletion will fail where channel permissions do not grant it.',
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

  private async checkCaseRole(
    guild: Guild,
    botMember: GuildMember,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    await this.checkCaseRoleId(guild, botMember, serverConfig.case_role_id, issues);
  }

  private async checkCaseRoleCandidate(
    guild: Guild,
    botMember: GuildMember,
    candidate: SetupCandidate,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (candidate.caseRoleId) {
      await this.checkCaseRoleId(guild, botMember, candidate.caseRoleId, issues);
      return;
    }

    if (candidate.willCreateCaseRole) {
      return;
    }

    issues.push({
      severity: 'error',
      code: 'case-role-missing',
      message: 'Case role is not configured.',
    });
  }

  private async checkCaseRoleId(
    guild: Guild,
    botMember: GuildMember,
    caseRoleId: string | null | undefined,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (!caseRoleId) {
      issues.push({
        severity: 'error',
        code: 'case-role-missing',
        message: 'Case role is not configured.',
      });
      return;
    }

    const caseRole = await guild.roles.fetch(caseRoleId).catch(() => null);
    if (!caseRole) {
      issues.push({
        severity: 'error',
        code: 'case-role-not-found',
        message: `Case role ${caseRoleId} no longer exists.`,
      });
      return;
    }

    if (caseRole.id === guild.id) {
      issues.push({
        severity: 'error',
        code: 'case-role-everyone',
        message: 'Case role cannot be @everyone.',
      });
    }

    if (caseRole.managed) {
      issues.push({
        severity: 'error',
        code: 'case-role-managed',
        message: `Case role <@&${caseRole.id}> is managed by an integration and cannot be assigned by Drasil.`,
      });
    }

    if (botMember.roles.highest.comparePositionTo(caseRole) <= 0) {
      issues.push({
        severity: 'error',
        code: 'case-role-hierarchy',
        message: `Move the Drasil role above the selected case role <@&${caseRole.id}>.`,
      });
    }
  }

  private async checkManualIntakeRole(
    guild: Guild,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    const settings = getManualIntakeSettings(serverConfig.settings);
    if (!settings.enabled || !settings.roleId) {
      return;
    }

    if (settings.roleId === serverConfig.case_role_id) {
      issues.push({
        severity: 'warning',
        code: 'manual-intake-role-is-case-role',
        message:
          'Manual intake trigger role matches the case role. Use a separate non-case role such as @Pending Investigation.',
      });
      return;
    }

    const role = await guild.roles.fetch(settings.roleId).catch(() => null);
    if (!role) {
      issues.push({
        severity: 'warning',
        code: 'manual-intake-role-not-found',
        message: `Manual intake trigger role ${settings.roleId} no longer exists.`,
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
        candidate.willSyncVerificationChannelPermissions
          ? VERIFICATION_CHANNEL_SYNC_PERMISSIONS
          : VERIFICATION_CHANNEL_PERMISSIONS,
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

  private async checkAdminNotificationRole(
    guild: Guild,
    botMember: GuildMember,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    const roleId = serverConfig.admin_notification_role_id;
    if (!roleId) {
      return;
    }

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      issues.push({
        severity: 'warning',
        code: 'admin-notification-role-not-found',
        message: `Admin notification role ${roleId} no longer exists.`,
      });
      return;
    }

    const adminChannelId = serverConfig.admin_channel_id;
    const channel = adminChannelId
      ? await guild.channels.fetch(adminChannelId).catch(() => null)
      : null;
    if (!channel || channel.type !== ChannelType.GuildText) {
      return;
    }

    const canMentionRole =
      role.mentionable ||
      (channel as TextChannel).permissionsFor(botMember).has(PermissionFlagsBits.MentionEveryone);
    if (!canMentionRole) {
      issues.push({
        severity: 'warning',
        code: 'admin-notification-role-mention',
        message: `Drasil may not be able to mention admin notification role <@&${role.id}> in <#${channel.id}>. Make the role mentionable or grant Mention Everyone.`,
      });
    }
  }

  private async checkCaseResponderRoles(
    guild: Guild,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    const settings = getCaseResponderSettings(serverConfig.settings);
    if (settings.roleIds.length === 0) {
      return;
    }

    for (const roleId of settings.roleIds) {
      const role = await guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        issues.push({
          severity: 'warning',
          code: 'case-responder-role-not-found',
          message: `Case responder role ${roleId} no longer exists.`,
        });
        continue;
      }

      if (
        settings.routingMode === 'ping_and_add_members' &&
        role.members.size > settings.threadMemberCap
      ) {
        issues.push({
          severity: 'warning',
          code: 'case-responder-role-member-cap',
          message: `Case responder role <@&${role.id}> has ${role.members.size} cached members, above cap ${settings.threadMemberCap}; Drasil will ping the role instead of adding every member to case threads.`,
        });
      }
    }
  }

  private async checkRoleGateRoles(
    guild: Guild,
    botMember: GuildMember,
    serverConfig: Server,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    const settings = getRoleGateSettings(serverConfig.settings);
    if (!settings.enabled) {
      return;
    }

    if (!settings.honeypotRoleId && !settings.memberAccessRoleId) {
      issues.push({
        severity: 'warning',
        code: 'role-gate-no-roles',
        message:
          'Role gate is enabled, but neither a honeypot role nor a member access role is configured.',
      });
      return;
    }

    if (
      settings.honeypotRoleId &&
      settings.memberAccessRoleId &&
      settings.honeypotRoleId === settings.memberAccessRoleId
    ) {
      issues.push({
        severity: 'warning',
        code: 'role-gate-same-role',
        message: 'Honeypot role and member access role should not be the same role.',
      });
    }

    await this.checkRoleGateRoleId(
      guild,
      botMember,
      settings.honeypotRoleId,
      'honeypot-role',
      'Honeypot role',
      issues
    );
    await this.checkRoleGateRoleId(
      guild,
      botMember,
      settings.memberAccessRoleId,
      'member-access-role',
      'Member access role',
      issues
    );
  }

  private async checkRoleGateRoleId(
    guild: Guild,
    botMember: GuildMember,
    roleId: string | null,
    codePrefix: string,
    label: string,
    issues: SetupDiagnosticIssue[]
  ): Promise<void> {
    if (!roleId) {
      return;
    }

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      issues.push({
        severity: 'warning',
        code: `${codePrefix}-not-found`,
        message: `${label} ${roleId} no longer exists.`,
      });
      return;
    }

    if (role.id === guild.id) {
      issues.push({
        severity: 'warning',
        code: `${codePrefix}-everyone`,
        message: `${label} cannot be @everyone.`,
      });
    }
    if (role.managed) {
      issues.push({
        severity: 'warning',
        code: `${codePrefix}-managed`,
        message: `${label} <@&${role.id}> is managed by an integration and cannot be changed by Drasil.`,
      });
    }
    if (botMember.roles.highest.comparePositionTo(role) <= 0) {
      issues.push({
        severity: 'warning',
        code: `${codePrefix}-hierarchy`,
        message: `Move the Drasil role above ${label.toLowerCase()} <@&${role.id}> for role-gate cleanup.`,
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
