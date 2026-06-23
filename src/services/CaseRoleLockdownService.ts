import {
  ChannelType,
  Guild,
  GuildMember,
  NonThreadGuildBasedChannel,
  OverwriteResolvable,
  PermissionFlagsBits,
  PermissionOverwriteManager,
  PermissionOverwriteOptions,
  PermissionsBitField,
  OverwriteType,
  Role,
} from 'discord.js';
import { inject, injectable } from 'inversify';
import { IConfigService } from '../config/ConfigService';
import { TYPES } from '../di/symbols';
import { ServerSettings } from '../repositories/types';
import {
  getCaseRoleLockdownSettings,
  CASE_ROLE_LOCKDOWN_ENABLED_SETTING_KEY,
} from '../utils/caseRoleLockdownSettings';

export type CaseRoleLockdownSeverity = 'error' | 'warning';
export type CaseRoleLockdownActionScope = 'category' | 'channel';

export interface CaseRoleLockdownIssue {
  readonly severity: CaseRoleLockdownSeverity;
  readonly code: string;
  readonly message: string;
}

export interface CaseRoleLockdownPlannedAction {
  readonly scope: CaseRoleLockdownActionScope;
  readonly channelId: string;
  readonly channelName: string;
}

export interface CaseRoleLockdownApplyFailure extends CaseRoleLockdownPlannedAction {
  readonly message: string;
}

export interface CaseRoleLockdownApplyOptions {
  readonly unsyncAllowedChannels?: boolean;
}

export interface CaseRoleLockdownReport {
  readonly guildId: string;
  readonly checkedAt: Date;
  readonly enabled: boolean;
  readonly allowedChannelIds: readonly string[];
  readonly allowedCategoryIds: readonly string[];
  readonly autoAllowedChannelIds: readonly string[];
  readonly issues: readonly CaseRoleLockdownIssue[];
  readonly plannedActions: readonly CaseRoleLockdownPlannedAction[];
  readonly appliedActions: readonly CaseRoleLockdownPlannedAction[];
  readonly failedActions: readonly CaseRoleLockdownApplyFailure[];
  readonly syncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
  readonly unsyncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface ICaseRoleLockdownService {
  auditGuild(guild: Guild): Promise<CaseRoleLockdownReport>;
  applyGuild(
    guild: Guild,
    actorId: string,
    options?: CaseRoleLockdownApplyOptions
  ): Promise<CaseRoleLockdownReport>;
}

interface LockdownPermission {
  readonly flag: bigint;
  readonly option: keyof PermissionOverwriteOptions;
  readonly label: string;
}

interface PermissionLabel {
  readonly flag: bigint;
  readonly label: string;
}

type LockdownChannel = NonThreadGuildBasedChannel & {
  readonly parentId?: string | null;
  readonly permissionsLocked?: boolean | null;
  readonly permissionOverwrites: PermissionOverwriteManager;
  permissionsFor(memberOrRole: GuildMember | Role | string): PermissionsBitField | null;
};

const LOCKDOWN_PERMISSIONS: readonly LockdownPermission[] = [
  { flag: PermissionFlagsBits.ViewChannel, option: 'ViewChannel', label: 'View Channel' },
  { flag: PermissionFlagsBits.SendMessages, option: 'SendMessages', label: 'Send Messages' },
  {
    flag: PermissionFlagsBits.SendMessagesInThreads,
    option: 'SendMessagesInThreads',
    label: 'Send Messages in Threads',
  },
  {
    flag: PermissionFlagsBits.CreatePublicThreads,
    option: 'CreatePublicThreads',
    label: 'Create Public Threads',
  },
  {
    flag: PermissionFlagsBits.CreatePrivateThreads,
    option: 'CreatePrivateThreads',
    label: 'Create Private Threads',
  },
  { flag: PermissionFlagsBits.Connect, option: 'Connect', label: 'Connect' },
  { flag: PermissionFlagsBits.Speak, option: 'Speak', label: 'Speak' },
];

const LOCKDOWN_PERMISSION_OPTIONS = LOCKDOWN_PERMISSIONS.reduce<PermissionOverwriteOptions>(
  (options, permission) => ({ ...options, [permission.option]: false }),
  {}
);

const HIGH_RISK_RESTRICTED_ROLE_PERMISSIONS: readonly PermissionLabel[] = [
  { flag: PermissionFlagsBits.Administrator, label: 'Administrator' },
  ...LOCKDOWN_PERMISSIONS,
];

@injectable()
export class CaseRoleLockdownService implements ICaseRoleLockdownService {
  constructor(@inject(TYPES.ConfigService) private readonly configService: IConfigService) {}

  public async auditGuild(guild: Guild): Promise<CaseRoleLockdownReport> {
    return this.buildReport(guild, false);
  }

  public async applyGuild(
    guild: Guild,
    actorId: string,
    options: CaseRoleLockdownApplyOptions = {}
  ): Promise<CaseRoleLockdownReport> {
    let report = await this.buildReport(guild, false);
    let unsyncedAllowedChannels: CaseRoleLockdownPlannedAction[] = [];

    if (report.errorCount > 0) {
      const onlySyncedAllowedChannelErrors =
        report.syncedAllowedChannels.length > 0 &&
        report.errorCount === report.syncedAllowedChannels.length;
      if (!options.unsyncAllowedChannels || !onlySyncedAllowedChannelErrors) {
        return report;
      }

      const unsyncResult = await this.unsyncAllowedChannelsUnderDeniedCategories(
        guild,
        report.syncedAllowedChannels,
        actorId
      );
      unsyncedAllowedChannels = unsyncResult.unsyncedActions;
      const recentlyUnsyncedAllowedChannelIds = new Set(
        unsyncedAllowedChannels.map((action) => action.channelId)
      );

      if (unsyncResult.failedActions.length > 0) {
        const refreshed = await this.buildReport(guild, false, recentlyUnsyncedAllowedChannelIds);
        return this.toReport({
          guildId: refreshed.guildId,
          checkedAt: refreshed.checkedAt,
          enabled: refreshed.enabled,
          allowedChannelIds: refreshed.allowedChannelIds,
          allowedCategoryIds: refreshed.allowedCategoryIds,
          autoAllowedChannelIds: refreshed.autoAllowedChannelIds,
          issues: [...refreshed.issues, ...this.applyFailuresToIssues(unsyncResult.failedActions)],
          plannedActions: refreshed.plannedActions,
          appliedActions: [],
          failedActions: unsyncResult.failedActions,
          syncedAllowedChannels: refreshed.syncedAllowedChannels,
          unsyncedAllowedChannels,
        });
      }

      report = await this.buildReport(guild, false, recentlyUnsyncedAllowedChannelIds);
      if (report.errorCount > 0) {
        return { ...report, unsyncedAllowedChannels };
      }
    }

    if (report.plannedActions.length === 0) {
      if (!report.enabled) {
        await this.configService.updateServerSettings(guild.id, {
          [CASE_ROLE_LOCKDOWN_ENABLED_SETTING_KEY]: true,
        });
      }
      return { ...report, enabled: true, unsyncedAllowedChannels };
    }

    const serverConfig = await this.configService.getServerConfig(guild.id);
    if (!serverConfig.case_role_id) {
      const failedActions = report.plannedActions.map((action) => ({
        ...action,
        message: 'Case role is no longer configured.',
      }));
      return this.toReport({
        guildId: report.guildId,
        checkedAt: new Date(),
        enabled: report.enabled,
        allowedChannelIds: report.allowedChannelIds,
        allowedCategoryIds: report.allowedCategoryIds,
        autoAllowedChannelIds: report.autoAllowedChannelIds,
        issues: [...report.issues, ...this.applyFailuresToIssues(failedActions)],
        plannedActions: report.plannedActions,
        appliedActions: [],
        failedActions,
        syncedAllowedChannels: report.syncedAllowedChannels,
        unsyncedAllowedChannels,
      });
    }

    const channels = await this.fetchLockdownChannels(guild);
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const appliedActions: CaseRoleLockdownPlannedAction[] = [];
    const failedActions: CaseRoleLockdownApplyFailure[] = [];

    for (const action of report.plannedActions) {
      const channel = channelById.get(action.channelId);
      if (!channel) {
        failedActions.push({ ...action, message: 'Channel was not found during apply.' });
        continue;
      }

      try {
        await channel.permissionOverwrites.edit(
          serverConfig.case_role_id,
          LOCKDOWN_PERMISSION_OPTIONS,
          {
            reason: `Drasil case-role lockdown applied by ${actorId}`,
          }
        );
        appliedActions.push(action);
      } catch (error) {
        failedActions.push({
          ...action,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (appliedActions.length > 0) {
      await this.configService.updateServerSettings(guild.id, {
        [CASE_ROLE_LOCKDOWN_ENABLED_SETTING_KEY]: true,
      });
    }

    const refreshed = await this.buildReport(
      guild,
      true,
      new Set(unsyncedAllowedChannels.map((action) => action.channelId))
    );
    return this.toReport({
      guildId: guild.id,
      checkedAt: refreshed.checkedAt,
      enabled: appliedActions.length > 0 || refreshed.enabled,
      allowedChannelIds: refreshed.allowedChannelIds,
      allowedCategoryIds: refreshed.allowedCategoryIds,
      autoAllowedChannelIds: refreshed.autoAllowedChannelIds,
      issues: [...refreshed.issues, ...this.applyFailuresToIssues(failedActions)],
      plannedActions: refreshed.plannedActions,
      appliedActions,
      failedActions,
      syncedAllowedChannels: refreshed.syncedAllowedChannels,
      unsyncedAllowedChannels,
    });
  }

  private async buildReport(
    guild: Guild,
    skipSetupChecks: boolean,
    recentlyUnsyncedAllowedChannelIds: ReadonlySet<string> = new Set()
  ): Promise<CaseRoleLockdownReport> {
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const settings = getCaseRoleLockdownSettings(serverConfig.settings);
    const autoAllowedChannelIds = this.getAutoAllowedChannelIds(serverConfig.settings, [
      serverConfig.verification_channel_id,
    ]);
    const issues: CaseRoleLockdownIssue[] = [];
    const plannedActions: CaseRoleLockdownPlannedAction[] = [];
    const syncedAllowedChannels: CaseRoleLockdownPlannedAction[] = [];
    const botMember = await this.getBotMember(guild);
    const caseRole = await this.getCaseRole(guild, serverConfig.case_role_id);

    if (!skipSetupChecks) {
      this.checkBotPermissions(botMember, issues);
      this.checkCaseRole(caseRole, botMember, issues);
    }

    if (!caseRole) {
      return this.toReport({
        guildId: guild.id,
        checkedAt: new Date(),
        enabled: settings.enabled,
        allowedChannelIds: settings.allowedChannelIds,
        allowedCategoryIds: settings.allowedCategoryIds,
        autoAllowedChannelIds,
        issues,
        plannedActions,
        appliedActions: [],
        failedActions: [],
        syncedAllowedChannels,
        unsyncedAllowedChannels: [],
      });
    }

    const channels = await this.fetchLockdownChannels(guild);
    const categories = channels.filter((channel) => channel.type === ChannelType.GuildCategory);
    const deniedCategoryIds = new Set<string>();
    const allowedChannelIds = new Set([...settings.allowedChannelIds, ...autoAllowedChannelIds]);
    const allowedCategoryIds = new Set(settings.allowedCategoryIds);

    this.checkConfiguredAllowList(channels, allowedChannelIds, allowedCategoryIds, issues);
    this.checkCaseRoleGlobalPermissions(caseRole, issues);

    for (const category of categories) {
      if (allowedCategoryIds.has(category.id)) {
        continue;
      }

      deniedCategoryIds.add(category.id);
      this.checkConflictingRoleAllows(guild, botMember, category, caseRole.id, issues);
      if (!this.hasCaseRoleLockdownDeny(category, caseRole.id)) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-category-missing-deny',
          message: `Category ${this.formatChannel(category)} is missing case-role lockdown denies.`,
        });
        plannedActions.push(this.toPlannedAction(category, 'category'));
      }
    }

    for (const channel of channels) {
      if (channel.type === ChannelType.GuildCategory) {
        continue;
      }

      const parentId = channel.parentId ?? null;
      if (allowedChannelIds.has(channel.id)) {
        if (
          parentId &&
          deniedCategoryIds.has(parentId) &&
          channel.permissionsLocked === true &&
          !recentlyUnsyncedAllowedChannelIds.has(channel.id)
        ) {
          syncedAllowedChannels.push(this.toPlannedAction(channel, 'channel'));
          issues.push({
            severity: 'error',
            code: 'lockdown-allowed-channel-synced-under-denied-category',
            message: `Allowed channel ${this.formatChannel(channel)} is synced under a denied category. Move it, allow the category, or rerun apply with \`unsync-allowed:true\` to copy current parent permissions before applying lockdown.`,
          });
        }
        continue;
      }

      if (parentId && allowedCategoryIds.has(parentId)) {
        continue;
      }

      if (this.isSyncedToParent(channel)) {
        continue;
      }

      this.checkConflictingRoleAllows(guild, botMember, channel, caseRole.id, issues);
      if (!this.hasCaseRoleLockdownDeny(channel, caseRole.id)) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-channel-missing-deny',
          message: `Unsynced channel ${this.formatChannel(channel)} is missing case-role lockdown denies.`,
        });
        plannedActions.push(this.toPlannedAction(channel, 'channel'));
      }
    }

    return this.toReport({
      guildId: guild.id,
      checkedAt: new Date(),
      enabled: settings.enabled,
      allowedChannelIds: settings.allowedChannelIds,
      allowedCategoryIds: settings.allowedCategoryIds,
      autoAllowedChannelIds,
      issues,
      plannedActions,
      appliedActions: [],
      failedActions: [],
      syncedAllowedChannels,
      unsyncedAllowedChannels: [],
    });
  }

  private async getBotMember(guild: Guild): Promise<GuildMember | null> {
    return guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  }

  private async getCaseRole(guild: Guild, roleId: string | null): Promise<Role | null> {
    if (!roleId) {
      return null;
    }

    return guild.roles.fetch(roleId).catch(() => null);
  }

  private checkBotPermissions(
    botMember: GuildMember | null,
    issues: CaseRoleLockdownIssue[]
  ): void {
    if (!botMember) {
      issues.push({
        severity: 'error',
        code: 'lockdown-bot-member-missing',
        message: 'Could not load Drasil as a server member, so lockdown cannot be audited.',
      });
      return;
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageChannels)) {
      issues.push({
        severity: 'error',
        code: 'lockdown-bot-manage-channels',
        message: 'Drasil is missing Manage Channels, so it cannot apply lockdown overwrites.',
      });
    }

    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      issues.push({
        severity: 'error',
        code: 'lockdown-bot-manage-roles',
        message: 'Drasil is missing Manage Roles, so it cannot safely manage the case role.',
      });
    }
  }

  private checkCaseRole(
    caseRole: Role | null,
    botMember: GuildMember | null,
    issues: CaseRoleLockdownIssue[]
  ): void {
    if (!caseRole) {
      issues.push({
        severity: 'error',
        code: 'lockdown-case-role-missing',
        message: 'Case role is not configured or no longer exists.',
      });
      return;
    }

    if (caseRole.managed) {
      issues.push({
        severity: 'error',
        code: 'lockdown-case-role-managed',
        message: `Case role <@&${caseRole.id}> is managed by an integration and cannot be assigned by Drasil.`,
      });
    }

    if (botMember && botMember.roles.highest.comparePositionTo(caseRole) <= 0) {
      issues.push({
        severity: 'error',
        code: 'lockdown-case-role-hierarchy',
        message: `Move the Drasil role above case role <@&${caseRole.id}> so Drasil can assign and remove it.`,
      });
    }
  }

  private checkCaseRoleGlobalPermissions(caseRole: Role, issues: CaseRoleLockdownIssue[]): void {
    const riskyPermissions = HIGH_RISK_RESTRICTED_ROLE_PERMISSIONS.filter((permission) =>
      caseRole.permissions.has(permission.flag)
    );
    if (riskyPermissions.length === 0) {
      return;
    }

    issues.push({
      severity: 'warning',
      code: 'lockdown-case-role-global-permissions',
      message: `Case role <@&${caseRole.id}> has global permissions that can weaken quarantine: ${riskyPermissions.map((permission) => permission.label).join(', ')}. Prefer an empty role and channel overwrites.`,
    });
  }

  private checkConfiguredAllowList(
    channels: readonly LockdownChannel[],
    allowedChannelIds: ReadonlySet<string>,
    allowedCategoryIds: ReadonlySet<string>,
    issues: CaseRoleLockdownIssue[]
  ): void {
    const channelIds = new Set(channels.map((channel) => channel.id));
    for (const channelId of allowedChannelIds) {
      if (!channelIds.has(channelId)) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-allowed-channel-not-found',
          message: `Allowed lockdown channel ${channelId} no longer exists.`,
        });
      }
    }

    for (const categoryId of allowedCategoryIds) {
      const category = channels.find((channel) => channel.id === categoryId);
      if (!category) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-allowed-category-not-found',
          message: `Allowed lockdown category ${categoryId} no longer exists.`,
        });
        continue;
      }

      if (category.type !== ChannelType.GuildCategory) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-allowed-category-not-category',
          message: `Allowed lockdown category ${categoryId} is not a category. Remove it and add the channel instead.`,
        });
      }
    }
  }

  private checkConflictingRoleAllows(
    guild: Guild,
    botMember: GuildMember | null,
    channel: LockdownChannel,
    caseRoleId: string,
    issues: CaseRoleLockdownIssue[]
  ): void {
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.id === caseRoleId) {
        continue;
      }

      const isMemberOverwrite = overwrite.type === OverwriteType.Member;
      if (!isMemberOverwrite && this.shouldSkipRoleAllowWarning(guild, botMember, overwrite.id)) {
        continue;
      }

      const mentionPrefix = isMemberOverwrite ? '@' : '@&';
      const affectedSubject = isMemberOverwrite ? 'That user' : 'Users with that role';

      if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-conflicting-send-allow',
          message: `${this.formatChannel(channel)} has an explicit Send Messages allow for <${mentionPrefix}${overwrite.id}>. ${affectedSubject} may still post there despite the case-role deny; remove the channel/category allow or quarantine conflicting roles for active cases.`,
        });
        continue;
      }

      if (overwrite.allow.has(PermissionFlagsBits.ViewChannel)) {
        issues.push({
          severity: 'warning',
          code: 'lockdown-conflicting-view-allow',
          message: `${this.formatChannel(channel)} has an explicit View Channel allow for <${mentionPrefix}${overwrite.id}>. ${affectedSubject} may still see it despite the case-role deny, but no explicit posting allow was detected.`,
        });
      }
    }
  }

  private shouldSkipRoleAllowWarning(
    guild: Guild,
    botMember: GuildMember | null,
    roleId: string
  ): boolean {
    if (roleId === guild.roles.everyone.id) {
      return true;
    }

    const botRoleCache = botMember
      ? (botMember.roles as { cache?: { has(roleId: string): boolean } }).cache
      : undefined;
    if (botRoleCache?.has(roleId)) {
      return true;
    }

    const role = (guild.roles as { cache?: { get(roleId: string): Role | undefined } }).cache?.get(
      roleId
    );
    const botRoleId = (role as { tags?: { botId?: string | null } } | undefined)?.tags?.botId;
    return role?.managed === true || typeof botRoleId === 'string';
  }

  private hasCaseRoleLockdownDeny(channel: LockdownChannel, caseRoleId: string): boolean {
    const overwrite = channel.permissionOverwrites.cache.get(caseRoleId);
    return LOCKDOWN_PERMISSIONS.every((permission) => overwrite?.deny.has(permission.flag));
  }

  private async fetchLockdownChannels(guild: Guild): Promise<LockdownChannel[]> {
    const fetchedChannels = await guild.channels.fetch();
    return [...fetchedChannels.values()].filter((channel): channel is LockdownChannel =>
      this.isLockdownChannel(channel)
    );
  }

  private async unsyncAllowedChannelsUnderDeniedCategories(
    guild: Guild,
    syncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[],
    actorId: string
  ): Promise<{
    unsyncedActions: CaseRoleLockdownPlannedAction[];
    failedActions: CaseRoleLockdownApplyFailure[];
  }> {
    const serverConfig = await this.configService.getServerConfig(guild.id);
    const caseRole = await this.getCaseRole(guild, serverConfig.case_role_id);
    if (!caseRole) {
      return {
        unsyncedActions: [],
        failedActions: syncedAllowedChannels.map((action) => ({
          ...action,
          message: 'Case role is no longer configured.',
        })),
      };
    }

    const channels = await this.fetchLockdownChannels(guild);
    const channelById = new Map(channels.map((channel) => [channel.id, channel]));
    const unsyncedActions: CaseRoleLockdownPlannedAction[] = [];
    const failedActions: CaseRoleLockdownApplyFailure[] = [];

    for (const action of syncedAllowedChannels) {
      const channel = channelById.get(action.channelId);
      const parent = channel?.parentId ? channelById.get(channel.parentId) : undefined;
      if (!channel || !parent || parent.type !== ChannelType.GuildCategory) {
        failedActions.push({
          ...action,
          message: 'Allowed channel or parent category was not found.',
        });
        continue;
      }

      try {
        await channel.permissionOverwrites.set(
          this.buildUnsyncedAllowedChannelOverwrites(parent, caseRole.id),
          `Drasil case-role lockdown unsynced allowed channel by ${actorId}`
        );
        unsyncedActions.push(action);
      } catch (error) {
        failedActions.push({
          ...action,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { unsyncedActions, failedActions };
  }

  private buildUnsyncedAllowedChannelOverwrites(
    parent: LockdownChannel,
    caseRoleId: string
  ): OverwriteResolvable[] {
    const copiedParentOverwrites: OverwriteResolvable[] = [
      ...parent.permissionOverwrites.cache.values(),
    ]
      .filter((overwrite) => overwrite.id !== caseRoleId)
      .map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow.bitfield,
        deny: overwrite.deny.bitfield,
      }));

    const caseRoleOptions = LOCKDOWN_PERMISSIONS.reduce<PermissionOverwriteOptions>(
      (options, permission) => {
        options[permission.option] = true;
        return options;
      },
      {}
    );

    return [
      ...copiedParentOverwrites,
      {
        id: caseRoleId,
        type: OverwriteType.Role,
        ...caseRoleOptions,
      },
    ];
  }

  private isLockdownChannel(
    channel: NonThreadGuildBasedChannel | null
  ): channel is LockdownChannel {
    if (!channel) {
      return false;
    }

    const maybeChannel = channel as Partial<LockdownChannel>;
    return Boolean(maybeChannel.permissionOverwrites && maybeChannel.permissionsFor);
  }

  private isSyncedToParent(channel: LockdownChannel): boolean {
    return Boolean(channel.parentId && channel.permissionsLocked === true);
  }

  private toPlannedAction(
    channel: LockdownChannel,
    scope: CaseRoleLockdownActionScope
  ): CaseRoleLockdownPlannedAction {
    return {
      scope,
      channelId: channel.id,
      channelName: channel.name,
    };
  }

  private getAutoAllowedChannelIds(
    settings: ServerSettings | undefined,
    channelIds: readonly (string | null | undefined)[]
  ): string[] {
    const ids = new Set<string>();
    for (const channelId of channelIds) {
      if (channelId) {
        ids.add(channelId);
      }
    }

    const reportInstructionsChannelId = settings?.report_instructions_channel_id;
    if (typeof reportInstructionsChannelId === 'string' && reportInstructionsChannelId) {
      ids.add(reportInstructionsChannelId);
    }

    return [...ids];
  }

  private applyFailuresToIssues(
    failures: readonly CaseRoleLockdownApplyFailure[]
  ): CaseRoleLockdownIssue[] {
    return failures.map((failure) => ({
      severity: 'error',
      code: 'lockdown-apply-failed',
      message: `Failed to apply lockdown to ${failure.scope} #${failure.channelName} (${failure.channelId}): ${failure.message}`,
    }));
  }

  private formatChannel(channel: Pick<LockdownChannel, 'id' | 'name'>): string {
    return `#${channel.name} (${channel.id})`;
  }

  private toReport(input: {
    readonly guildId: string;
    readonly checkedAt: Date;
    readonly enabled: boolean;
    readonly allowedChannelIds: readonly string[];
    readonly allowedCategoryIds: readonly string[];
    readonly autoAllowedChannelIds: readonly string[];
    readonly issues: readonly CaseRoleLockdownIssue[];
    readonly plannedActions: readonly CaseRoleLockdownPlannedAction[];
    readonly appliedActions: readonly CaseRoleLockdownPlannedAction[];
    readonly failedActions: readonly CaseRoleLockdownApplyFailure[];
    readonly syncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
    readonly unsyncedAllowedChannels: readonly CaseRoleLockdownPlannedAction[];
  }): CaseRoleLockdownReport {
    return {
      ...input,
      errorCount: input.issues.filter((issue) => issue.severity === 'error').length,
      warningCount: input.issues.filter((issue) => issue.severity === 'warning').length,
    };
  }
}
